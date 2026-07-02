// PJ1 / ADR-111 verification: the activity_events log emission + derived clock.
// Live Neon: record_created fires for a tracked record (project) but not a task;
// status_changed fires for a tracked record's own status (payload from/to) but
// not for a non-tracked task; task_completed fires on a task's tracked home
// parent (and not when the task has no home parent); checkin_reviewed resets the
// derived last_reviewed_at; listActivity is newest-first.
// Cleans up. Run: npx tsx scripts/verify-activity-log.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const {
  createItem,
  updateItem,
  toggleItemDone,
} = await import("../src/lib/item-mutations");
const { setHome } = await import("../src/lib/relations");
const { listActivity, lastReviewedAt, reviewCheckin } = await import("../src/lib/activity");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string) {
  const it = await createItem(ownerId, { type, title });
  created.push(it.id);
  return it;
}

console.log("\n# record_created");
{
  const project = await make("project", "PJ1 log project");
  const log = await listActivity(ownerId, project.id);
  check("creating a project emits record_created", log.some((e) => e.kind === "record_created"), log.map((e) => e.kind).join(","));

  const task = await make("task", "PJ1 log task (no event)");
  const taskLog = await listActivity(ownerId, task.id);
  check("creating a task emits no record_created (not tracked)", taskLog.length === 0);
}

console.log("\n# status_changed (tracked self only)");
{
  const project = await make("project", "PJ1 status project");
  await updateItem(ownerId, project.id, { status: "paused" });
  const log = await listActivity(ownerId, project.id);
  const ev = log.find((e) => e.kind === "status_changed");
  check("a project status change emits status_changed", !!ev);
  const payload = ev?.payload as { from?: string; to?: string } | null;
  check("status_changed carries from/to payload", payload?.to === "paused", JSON.stringify(payload));

  const task = await make("task", "PJ1 status task");
  await updateItem(ownerId, task.id, { status: "archived" });
  const taskLog = await listActivity(ownerId, task.id);
  check("a non-tracked task status change emits no status_changed", !taskLog.some((e) => e.kind === "status_changed"));
}

console.log("\n# task_completed (on the tracked home parent)");
{
  const project = await make("project", "PJ1 complete project");
  const task = await make("task", "PJ1 complete task");
  await setHome(ownerId, task.id, project.id, "project");
  await toggleItemDone(ownerId, task.id); // → done category
  const log = await listActivity(ownerId, project.id);
  check("completing a contained task emits task_completed on the parent", log.some((e) => e.kind === "task_completed" && e.actorId === task.id), log.map((e) => e.kind).join(","));

  // A homeless task completing logs nothing.
  const loneTask = await make("task", "PJ1 homeless task");
  await toggleItemDone(ownerId, loneTask.id);
  const loneLog = await listActivity(ownerId, loneTask.id);
  check("a homeless task completing logs nothing", loneLog.length === 0);
}

console.log("\n# checkin_reviewed resets the derived clock");
{
  const project = await make("project", "PJ1 checkin project");
  const before = await lastReviewedAt(ownerId, project.id);
  check("last_reviewed_at is null before any check-in", before === null);
  await reviewCheckin(ownerId, project.id);
  const after = await lastReviewedAt(ownerId, project.id);
  check("reviewCheckin sets a derived last_reviewed_at", after instanceof Date);
  const log = await listActivity(ownerId, project.id);
  check("reviewCheckin wrote a checkin_reviewed event", log.some((e) => e.kind === "checkin_reviewed"));
}

console.log("\n# newest-first ordering");
{
  const project = await make("project", "PJ1 order project");
  await updateItem(ownerId, project.id, { status: "paused" });
  await reviewCheckin(ownerId, project.id);
  const log = await listActivity(ownerId, project.id);
  const sorted = [...log].every((e, i, a) => i === 0 || a[i - 1].occurredAt >= e.occurredAt);
  check("listActivity returns newest-first", sorted);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of created) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
