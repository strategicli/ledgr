// @-mention → relations sync (PRD §4.1: a mention creates a relation row
// automatically). A mention lives in the canonical markdown body as a link
// whose href is `ledgr://item/<id>` (ADR-037/ADR-040); on every body save the
// relation rows with role 'mention' are diffed against what the body actually
// contains, so removing a mention removes its edge. Rows with any other role
// (tags, manual links) are never touched here.
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations, types } from "@/db/schema";
import { bodyMarkdown } from "@/lib/body";
import { collectMentionIdsFromMarkdown } from "@/lib/editor/mention-markdown";
import { NAV_ICON_FALLBACK } from "@/lib/nav-icons";

export const MENTION_ROLE = "mention";

// What a mention needs to render type-aware: the target's type, that type's
// configured icon key, and the item's live status category (for the task
// checkbox). Resolved from the DB at render time so the icon/status is never
// stale and the canonical markdown body stays just `[@Title](ledgr://item/<id>)`.
export type ResolvedMention = {
  id: string;
  title: string;
  type: string;
  icon: string;
  statusCategory: string;
};

// Owner-scoped, body-free batch lookup for the mentions in one body — the single
// resolver both the server print/share render and the in-editor chip read
// through (the editor via GET /api/items?ids=). An id that isn't the owner's
// live, non-template item is simply absent from the map; callers render those as
// the muted, non-navigating "missing" state. Reuses the same owner-scope +
// inArray shape syncMentionRelations uses.
export async function resolveMentions(
  ownerId: string,
  ids: string[]
): Promise<Map<string, ResolvedMention>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      type: items.type,
      icon: types.icon,
      statusCategory: items.statusCategory,
    })
    .from(items)
    .innerJoin(types, eq(types.key, items.type))
    .where(
      and(
        inArray(items.id, unique),
        eq(items.ownerId, ownerId),
        sql`${items.deletedAt} IS NULL`,
        eq(items.isTemplate, false)
      )
    );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        title: r.title,
        type: r.type,
        icon: r.icon ?? NAV_ICON_FALLBACK,
        statusCategory: r.statusCategory,
      },
    ])
  );
}

// Every distinct item id mentioned in a body. Tolerant of the body shape via
// bodyMarkdown, then scans the markdown for the mention link's href.
export function collectMentionIds(body: unknown): string[] {
  return collectMentionIdsFromMarkdown(bodyMarkdown(body));
}

export async function syncMentionRelations(
  ownerId: string,
  itemId: string,
  body: unknown
): Promise<void> {
  const db = getDb();
  const mentioned = new Set(collectMentionIds(body));
  mentioned.delete(itemId); // self-mention carries no information

  const existing = await db
    .select({ id: relations.id, targetId: relations.targetId })
    .from(relations)
    .where(
      and(eq(relations.sourceId, itemId), eq(relations.role, MENTION_ROLE))
    );

  const stale = existing.filter((r) => !mentioned.has(r.targetId));
  if (stale.length > 0) {
    await db.delete(relations).where(
      inArray(
        relations.id,
        stale.map((r) => r.id)
      )
    );
  }

  const have = new Set(existing.map((r) => r.targetId));
  const missing = [...mentioned].filter((id) => !have.has(id));
  if (missing.length === 0) return;

  // Owner-scope the targets: a body can only create edges to the owner's
  // own items, and dangling ids (deleted targets) are dropped silently.
  const valid = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        inArray(items.id, missing),
        eq(items.ownerId, ownerId),
        sql`${items.deletedAt} IS NULL`,
        // A mention can't point at a template prototype (ADR-093).
        eq(items.isTemplate, false)
      )
    );
  if (valid.length === 0) return;

  await db
    .insert(relations)
    .values(
      valid.map((t) => ({
        sourceId: itemId,
        targetId: t.id,
        role: MENTION_ROLE,
      }))
    )
    .onConflictDoNothing();
}
