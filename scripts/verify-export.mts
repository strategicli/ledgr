// Slice 17 verification: exercises the export engine (src/lib/export)
// against the live Neon DB with the local-filesystem target, under a
// throwaway user so no real item ever gets its exported_at stamped by a
// test run. Run with: npx tsx scripts/verify-export.mts
// Safe to delete once the slice is closed.
import { readFileSync, rmSync, existsSync } from "node:fs";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
// Force the no-storage path: attachment byte copies are exercised in the
// configured end-to-end run (runbook §1b), not here, where a fixture
// attachment's storageKey points at nothing.
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;

const { getDb } = await import("../src/db");
const { attachments, items, jobState, relations, users } = await import(
  "../src/db/schema"
);
const { EXPORT_JOB_KEY, getExportState, runExport } = await import(
  "../src/lib/export/engine"
);
const { LocalExportTarget } = await import("../src/lib/export/local");
const { and, eq, isNotNull, ne, sql } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const exportDir = await mkdtemp(join(tmpdir(), "ledgr-export-"));
const target = new LocalExportTarget(exportDir);
const onDisk = (path: string) => existsSync(join(exportDir, ...path.split("/")));

// Throwaway owner; everything hangs off it and hard-deletes at the end.
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-export-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

// Snapshot: no other owner's stamps may change during this run.
const stampedElsewhere = async () =>
  (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(and(ne(items.ownerId, ownerId), isNotNull(items.exportedAt)))
  )[0].count;
const stampedBefore = await stampedElsewhere();

try {
  // --- fixtures -----------------------------------------------------------
  const mkItem = async (input: Record<string, unknown>) =>
    (
      await db
        .insert(items)
        .values({ ownerId, ...(input as object) } as typeof items.$inferInsert)
        .returning()
    )[0];

  const body = [
    {
      id: "b1",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "Sermon outline body text", styles: {} }],
      children: [],
    },
  ];
  const task = await mkItem({
    type: "task",
    title: `Émile's Notes / Q1 — "draft"?`,
    body,
    dueDate: new Date("2026-06-19T00:00:00Z"),
  });
  const entity = await mkItem({ type: "entity", title: "Verify Person", kind: "person" });
  const distractor = await mkItem({ type: "entity", title: "Suggested Person", kind: "person" });
  const untitled = await mkItem({ type: "note", title: "" });
  await db.insert(relations).values([
    { sourceId: task.id, targetId: entity.id, role: "related", matchState: "confirmed" },
    { sourceId: distractor.id, targetId: task.id, role: "related", matchState: "suggested" },
  ]);
  await db.insert(attachments).values({
    ownerId,
    parentItemId: task.id,
    filename: "chart.png",
    contentType: "image/png",
    sizeBytes: 123,
    storageKey: "nonexistent/chart.png",
  });
  // Created and trashed before any export: must never be selected.
  const ghost = await mkItem({ type: "note", title: "Ghost note" });
  await db
    .update(items)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(items.id, ghost.id));

  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.LEDGR_TIMEZONE || "America/New_York",
    year: "numeric",
  }).format(new Date());
  const id8 = (id: string) => id.slice(0, 8);

  // --- first run ----------------------------------------------------------
  const run1 = await runExport(ownerId, target, {
    onError: (id, err) => console.error("item error", id, err),
  });
  check("run 1 exports the four live fixtures", run1.exported === 4, JSON.stringify(run1));
  check("run 1 clean (no errors, none remaining)", run1.errors === 0 && run1.remaining === 0);
  check("ghost (created+trashed, never exported) skipped",
    (await db.select().from(items).where(eq(items.id, ghost.id)))[0].exportedAt === null);

  const taskPath = `task/${year}/emile-s-notes-q1-draft-${id8(task.id)}.md`;
  check("slug strips diacritics, punctuation, quotes", onDisk(taskPath), taskPath);
  check("empty title slugs to untitled",
    onDisk(`note/${year}/untitled-${id8(untitled.id)}.md`));

  const md = await readFile(join(exportDir, ...taskPath.split("/")), "utf8");
  check("frontmatter carries id/type/status", md.includes(`id: "${task.id}"`) && md.includes(`type: "task"`) && md.includes(`status: "open"`));
  check("title is JSON-escaped YAML", md.includes(`title: ${JSON.stringify(task.title)}`));
  check("due date present", md.includes(`due: "2026-06-19T00:00:00.000Z"`));
  check("confirmed entity listed, suggested excluded",
    md.includes(`entities: ["Verify Person"]`) && !md.includes("Suggested Person"));
  check("attachment path listed",
    md.includes(`_attachments/${task.id}/`) && md.includes("-chart.png"));
  check("markdown body serialized", md.includes("Sermon outline body text"));
  check("attachment bytes skipped without storage (stamp stays null)",
    (await db.select().from(attachments).where(eq(attachments.parentItemId, task.id)))[0].exportedAt === null);

  // --- idempotence --------------------------------------------------------
  const run2 = await runExport(ownerId, target);
  check("run 2 is a no-op", run2.exported === 0 && run2.remaining === 0, JSON.stringify(run2));

  // --- rename relocates ---------------------------------------------------
  await db.update(items).set({ title: "Renamed task", updatedAt: new Date() }).where(eq(items.id, task.id));
  const run3 = await runExport(ownerId, target);
  const renamedPath = `task/${year}/renamed-task-${id8(task.id)}.md`;
  check("rename re-exports exactly one", run3.exported === 1);
  check("new path written, old path deleted", onDisk(renamedPath) && !onDisk(taskPath));

  // --- soft delete -> _archive, restore -> back ---------------------------
  await db.update(items).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(items.id, task.id));
  const run4 = await runExport(ownerId, target);
  const archivePath = `_archive/${renamedPath}`;
  check("trashed item moves to _archive", run4.archived === 1 && onDisk(archivePath) && !onDisk(renamedPath));
  check("frontmatter records deleted: true", (await readFile(join(exportDir, ...archivePath.split("/")), "utf8")).includes("deleted: true"));

  await db.update(items).set({ deletedAt: null, updatedAt: new Date() }).where(eq(items.id, task.id));
  const run5 = await runExport(ownerId, target);
  check("restore moves it back out of _archive", run5.exported === 1 && onDisk(renamedPath) && !onDisk(archivePath));

  // --- archived status also lands in _archive -----------------------------
  await db.update(items).set({ status: "archived", updatedAt: new Date() }).where(eq(items.id, task.id));
  await runExport(ownerId, target);
  check("status archived lands in _archive too", onDisk(archivePath) && !onDisk(renamedPath));

  // --- job state + /health source ----------------------------------------
  const state = await getExportState();
  check("job_state records a clean run",
    !!state && state.lastSuccessAt !== null && state.lastRunAt >= state.lastSuccessAt!,
    JSON.stringify(state));

  // --- owner scoping -------------------------------------------------------
  check("no other owner's items were stamped", (await stampedElsewhere()) === stampedBefore);
} finally {
  // Hard-delete fixtures (relations/attachments cascade), then the user and
  // the polluted job-state row so /health's canary stays honest.
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(jobState).where(eq(jobState.key, EXPORT_JOB_KEY));
  rmSync(exportDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
