// OneDrive export engine (slice 17, PRD §5.4). One-way, DB -> files:
// /Export/{type}/{year}/{slug}-{id8}.md with YAML frontmatter and the
// markdown body (the DB stays canonical; this is the disaster-recovery and
// pulpit fallback). Incremental: an item is re-exported when updated_at has
// passed exported_at (soft delete, restore, and status changes all bump
// updated_at, so the one comparison covers content, renames, and moves to
// /_archive/). Deterministic plumbing, no model in the loop.
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments, items, jobState } from "@/db/schema";
import { bodyMarkdown } from "@/lib/body";
import { getStorage } from "@/lib/storage";
import { APP_TIMEZONE } from "@/lib/today";
import type { ExportTarget } from "./target";

// Per-run cap: the nightly cron runs in a 60s lambda and attachments can be
// large; whatever a run can't reach is counted in `remaining` (logged, not
// silent) and the next run picks it up.
const DEFAULT_BATCH = 100;

export const EXPORT_JOB_KEY = "onedrive_export";

export type ExportRunResult = {
  exported: number;
  archived: number;
  attachmentsCopied: number;
  errors: number;
  remaining: number;
};

export type ExportJobState = {
  lastRunAt: string;
  // The /health canary: set only by a run that finished with zero item
  // errors and nothing remaining.
  lastSuccessAt: string | null;
  lastResult: ExportRunResult;
};

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics after NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "untitled";
}

// {year} comes from created_at in the app timezone: stable for the item's
// life (due/meeting dates are often null and titles change).
function yearInZone(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
  }).format(instant);
}

// Double-quoted JSON strings are valid YAML scalars, so JSON.stringify is
// the whole escaping story.
function yamlValue(v: string | string[] | boolean): string {
  return Array.isArray(v)
    ? `[${v.map((s) => JSON.stringify(s)).join(", ")}]`
    : typeof v === "boolean"
      ? String(v)
      : JSON.stringify(v);
}

type ItemRow = typeof items.$inferSelect;

function buildFrontmatter(
  item: ItemRow,
  people: string[],
  attachmentPaths: string[]
): string {
  const lines: string[] = ["---"];
  const add = (key: string, v: string | string[] | boolean | null | undefined) => {
    if (v == null || (Array.isArray(v) && v.length === 0)) return;
    lines.push(`${key}: ${yamlValue(v)}`);
  };
  add("id", item.id);
  add("type", item.type);
  add("title", item.title);
  // Status is a task field (ADR-018); "status: open" on every note would be
  // frontmatter noise. Archived non-tasks still land under /_archive/.
  if (item.type === "task") add("status", item.status);
  add("url", item.url);
  add("due", item.dueDate?.toISOString());
  add("meeting_at", item.meetingAt?.toISOString());
  add("created", item.createdAt.toISOString());
  add("updated", item.updatedAt.toISOString());
  add("people", people);
  add("attachments", attachmentPaths);
  if (item.deletedAt) add("deleted", true);
  lines.push("---");
  return lines.join("\n");
}

// Confirmed related-person edges in both directions (suggested edges stay out
// of trusted reads, PRD §3.3); titles only, for the frontmatter.
async function listPersonTitles(
  ownerId: string,
  itemId: string
): Promise<string[]> {
  const rows = await getDb().execute(sql`
    select distinct e.title
    from relations r
    join items e
      on e.id = case when r.source_id = ${itemId} then r.target_id else r.source_id end
    where (r.source_id = ${itemId} or r.target_id = ${itemId})
      and r.match_state = 'confirmed'
      and e.type = 'person'
      and e.owner_id = ${ownerId}
      and e.deleted_at is null
    order by e.title
  `);
  return rows.rows.map((r) => (r as { title: string }).title);
}

// Copies this item's not-yet-exported attachment bytes (R2 -> target) and
// returns the export paths of every attachment row, copied now or earlier.
// Bytes come off the public CDN URL (the same URL the editor renders), so
// no new storage-provider method is needed. Attachment bytes are immutable
// once uploaded: one copy is done forever.
async function exportAttachments(
  item: ItemRow,
  target: ExportTarget
): Promise<{ paths: string[]; copied: number }> {
  const db = getDb();
  const rows = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      storageKey: attachments.storageKey,
      exportedAt: attachments.exportedAt,
    })
    .from(attachments)
    .where(eq(attachments.parentItemId, item.id));
  if (rows.length === 0) return { paths: [], copied: 0 };

  const storage = getStorage();
  const paths: string[] = [];
  let copied = 0;
  for (const att of rows) {
    // id prefix: filenames repeat freely within an item (paste.png).
    const path = `_attachments/${item.id}/${att.id.slice(0, 8)}-${att.filename}`;
    paths.push(path);
    if (att.exportedAt) continue;
    if (!storage) {
      // Not an error: local/dev runs have no R2. The stamp stays null so a
      // configured run copies it later.
      continue;
    }
    const res = await fetch(storage.publicUrl(att.storageKey));
    if (!res.ok) {
      throw new Error(
        `attachment fetch failed (${res.status}) for ${att.storageKey}`
      );
    }
    await target.putFile(path, new Uint8Array(await res.arrayBuffer()));
    await db
      .update(attachments)
      .set({ exportedAt: new Date() })
      .where(eq(attachments.id, att.id));
    copied++;
  }
  return { paths, copied };
}

function needsExportWhere(ownerId: string) {
  return and(
    eq(items.ownerId, ownerId),
    or(
      // Never exported: live items only (an item created and trashed
      // between runs has no file to archive).
      and(isNull(items.exportedAt), isNull(items.deletedAt)),
      // Exported before and touched since (edits, soft delete, restore,
      // archive: they all bump updated_at).
      sql`${items.exportedAt} is not null and ${items.updatedAt} > ${items.exportedAt}`
    )
  );
}

// Runs one export pass for one owner. Item-level failures land in the
// returned error count (callers log them); the item keeps its old stamp and
// is retried next run.
export async function runExport(
  ownerId: string,
  target: ExportTarget,
  opts: { batch?: number; onError?: (itemId: string, err: unknown) => void } = {}
): Promise<ExportRunResult> {
  const db = getDb();
  const batch = Math.min(Math.max(opts.batch ?? DEFAULT_BATCH, 1), 500);

  const candidates = await db
    .select()
    .from(items)
    .where(needsExportWhere(ownerId))
    .orderBy(items.updatedAt)
    .limit(batch);

  const result: ExportRunResult = {
    exported: 0,
    archived: 0,
    attachmentsCopied: 0,
    errors: 0,
    remaining: 0,
  };

  for (const item of candidates) {
    try {
      const inArchive = item.deletedAt !== null || item.statusCategory === "archived";
      const year = yearInZone(item.createdAt);
      const name = `${slugify(item.title)}-${item.id.slice(0, 8)}.md`;
      const desired = `${inArchive ? "_archive/" : ""}${item.type}/${year}/${name}`;

      const [people, atts] = [
        await listPersonTitles(ownerId, item.id),
        await exportAttachments(item, target),
      ];
      result.attachmentsCopied += atts.copied;

      const content = `${buildFrontmatter(item, people, atts.paths)}\n\n${bodyMarkdown(item.body)}\n`;
      await target.putFile(desired, content);
      // A rename, retype, or live<->archive move leaves a stale file at the
      // old path; the put above already wrote the replacement.
      if (item.exportPath && item.exportPath !== desired) {
        await target.deleteFile(item.exportPath);
      }
      // Pin exportedAt and updatedAt to the same instant. updatedAt carries a
      // $onUpdate (schema.ts); without setting it explicitly it would land a
      // hair after exportedAt, so needsExportWhere's `updatedAt > exportedAt`
      // would re-select the item on the very next run (a spurious re-export).
      // The export write is bookkeeping, not a content edit.
      const exportedAt = new Date();
      await db
        .update(items)
        .set({ exportedAt, updatedAt: exportedAt, exportPath: desired })
        .where(and(eq(items.id, item.id), eq(items.ownerId, ownerId)));
      result.exported++;
      if (inArchive) result.archived++;
    } catch (err) {
      result.errors++;
      opts.onError?.(item.id, err);
    }
  }

  const left = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(needsExportWhere(ownerId));
  result.remaining = left[0].count;

  const now = new Date().toISOString();
  const clean = result.errors === 0 && result.remaining === 0;
  const prior = await db
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, EXPORT_JOB_KEY));
  const priorState = (prior[0]?.value ?? null) as ExportJobState | null;
  const state: ExportJobState = {
    lastRunAt: now,
    lastSuccessAt: clean ? now : (priorState?.lastSuccessAt ?? null),
    lastResult: result,
  };
  await db
    .insert(jobState)
    .values({ key: EXPORT_JOB_KEY, value: state })
    .onConflictDoUpdate({ target: jobState.key, set: { value: state } });

  return result;
}

export async function getExportState(): Promise<ExportJobState | null> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, EXPORT_JOB_KEY));
  return (rows[0]?.value as ExportJobState) ?? null;
}
