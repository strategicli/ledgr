// PJ6 / ADR-111 verification: the derived lenses — hierarchical Progress
// (indeterminate at zero, recursive average, 100%), Next Action, Recent Activity.
// Live Neon. Cleans up. Run: npx tsx scripts/verify-derived-widgets.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const { createItem, getItem, toggleItemDone, updateItem } = await import("../src/lib/items");
const { setHome } = await import("../src/lib/relations");
const { resolveRecordWidgets } = await import("../src/lib/record-widgets");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const approx = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string, extra: Record<string, unknown> = {}) {
  const it = await createItem(ownerId, { type, title, ...extra });
  created.push(it.id);
  return it;
}
const comp = (widgets: { instanceId: string; defId: string; options?: Record<string, unknown> }[]) =>
  ({ version: 1 as const, widgets, behaviors: {} });
async function progressOf(projectId: string) {
  const fresh = await getItem(ownerId, projectId);
  const data = await resolveRecordWidgets(
    ownerId,
    fresh,
    comp([{ instanceId: "progress", defId: "progress" }])
  );
  return data.find((d) => d.def.id === "progress")?.progress;
}

console.log("\n# indeterminate at zero tasks");
{
  const project = await make("project", "PJ6 empty project");
  check("no tasks → fraction null (not 0%)", (await progressOf(project.id))?.fraction === null);
}

console.log("\n# weighted points: subtasks add weight, partial credit by completion");
{
  const project = await make("project", "PJ6 hierarchy project");
  const top = await make("task", "PJ6 top task");
  await setHome(ownerId, top.id, project.id, "project");
  const sub1 = await make("task", "PJ6 sub 1", { parentId: top.id });
  await make("task", "PJ6 sub 2", { parentId: top.id });
  await toggleItemDone(ownerId, sub1.id); // 1 of 2 subtasks done → task fraction 0.5

  // one task with 2 subtasks → total = 3 (task) + 2×1 (subtasks) = 5 pts;
  // half-done → earned = 0.5 × 5 = 2.5 pts.
  const p = await progressOf(project.id);
  check("task with 2 subtasks is worth 5 pts", approx(p?.total, 5), String(p?.total));
  check("half-done task earns 2.5 pts (partial credit)", approx(p?.done, 2.5), String(p?.done));
  check("fraction = 2.5/5 = 0.5", approx(p?.fraction, 0.5), String(p?.fraction));
}

console.log("\n# milestones (5 pts, complete when past) and meetings (1 pt) count too");
{
  const project = await make("project", "PJ6 dated project");
  const past = await make("milestone", "PJ6 past milestone", { dueDate: new Date("2000-01-01T00:00:00.000Z") });
  const future = await make("milestone", "PJ6 future milestone", { dueDate: new Date("2999-01-01T00:00:00.000Z") });
  await setHome(ownerId, past.id, project.id, "contains");
  await setHome(ownerId, future.id, project.id, "contains");
  const p = await progressOf(project.id);
  check("two milestones = 10 pts total", approx(p?.total, 10), String(p?.total));
  check("one passed milestone = 5 pts done", approx(p?.done, 5), String(p?.done));
}

console.log("\n# 100% (suggest, never force)");
{
  const project = await make("project", "PJ6 done project");
  const t = await make("task", "PJ6 lone task");
  await setHome(ownerId, t.id, project.id, "project");
  await toggleItemDone(ownerId, t.id);
  const p = await progressOf(project.id);
  check("all done → fraction 1.0", approx(p?.fraction, 1));
  const proj = await getItem(ownerId, project.id);
  check("the project is NOT auto-forced to done (suggest only)", proj.statusCategory !== "done");
}

console.log("\n# nested recursion (3 levels)");
{
  const project = await make("project", "PJ6 nested project");
  const top = await make("task", "PJ6 nested top");
  await setHome(ownerId, top.id, project.id, "project");
  const mid = await make("task", "PJ6 nested mid", { parentId: top.id });
  const leaf1 = await make("task", "PJ6 leaf 1", { parentId: mid.id });
  await make("task", "PJ6 leaf 2", { parentId: mid.id });
  await toggleItemDone(ownerId, leaf1.id); // mid = avg(1,0)=0.5; top = avg(mid)=0.5
  const p = await progressOf(project.id);
  check("recursive: leaf→mid(0.5)→top(0.5)→bar(0.5)", approx(p?.fraction, 0.5), String(p?.fraction));
}

console.log("\n# Next Action + Recent Activity");
{
  const project = await make("project", "PJ6 derived project");
  const task = await make("task", "PJ6 the next thing");
  await setHome(ownerId, task.id, project.id, "project");
  await updateItem(ownerId, project.id, { nextActionTaskId: task.id });
  const fresh = await getItem(ownerId, project.id);
  const data = await resolveRecordWidgets(
    ownerId,
    fresh,
    comp([
      { instanceId: "nextAction", defId: "nextAction" },
      { instanceId: "recentActivity", defId: "recentActivity" },
    ])
  );
  const na = data.find((d) => d.def.id === "nextAction")?.nextAction;
  check("Next Action resolves the pinned task's title", na?.taskId === task.id && na?.taskTitle === "PJ6 the next thing");
  check("Recent Activity has lines (record_created + task_added)", (data.find((d) => d.def.id === "recentActivity")?.activity?.length ?? 0) >= 2);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
// Reverse creation order: delete subtask children before their parents (the
// parent_id self-FK has no cascade).
for (const id of [...created].reverse()) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
