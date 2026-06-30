// PJ5 / ADR-111 verification: the milestone type (polymorphic, no done-state),
// the Next Action pin + auto-advance, and the milestones fan-out. Live Neon.
// (The editable widget UIs + the /contain endpoint are exercised in-browser; the
// verify covers the server contracts they ride.) Cleans up.
// Run: npx tsx scripts/verify-record-widgets.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const { createItem, updateItem, toggleItemDone, getItem } = await import("../src/lib/items");
const { setHome } = await import("../src/lib/relations");
const { homeParentOf } = await import("../src/lib/activity");
const { getType } = await import("../src/lib/types");
const { resolveComposition } = await import("../src/lib/composition");
const { resolveRecordWidgets } = await import("../src/lib/record-widgets");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string, extra: Record<string, unknown> = {}) {
  const it = await createItem(ownerId, { type, title, ...extra });
  created.push(it.id);
  return it;
}

console.log("\n# milestone type");
{
  const mt = await getType("milestone");
  check("milestone is a system type", mt.isSystem === true);
  check("milestone is hidden + out of quick capture", mt.hidden === true && mt.showInQuickCapture === false);
  check("milestone has no status affordance (status_mode none)", mt.statusMode === "none");
}

console.log("\n# milestone: polymorphic attach + no done-state");
{
  const note = await make("note", "PJ5 host note");
  const ms = await make("milestone", "Booklet to printer", { dueDate: new Date("2026-07-15T00:00:00.000Z") });
  await setHome(ownerId, ms.id, note.id, "contains");
  const parent = await homeParentOf(ownerId, ms.id);
  check("a milestone attaches to a NON-project type (polymorphic)", parent?.id === note.id);
  check("a milestone has no done-state (stays not_started)", ms.statusCategory === "not_started");
  check("the milestone's date is its due_date", ms.dueDate?.toISOString() === "2026-07-15T00:00:00.000Z");
}

console.log("\n# Next Action pin + auto-advance");
{
  const project = await make("project", "PJ5 next-action project");
  const t1 = await make("task", "PJ5 first task");
  const t2 = await make("task", "PJ5 second task");
  await setHome(ownerId, t1.id, project.id, "project");
  await setHome(ownerId, t2.id, project.id, "project");
  await updateItem(ownerId, project.id, { nextActionTaskId: t1.id });

  await toggleItemDone(ownerId, t1.id); // complete the pinned task
  let p = await getItem(ownerId, project.id);
  check("completing the pinned task auto-advances to the next open task", p.nextActionTaskId === t2.id, String(p.nextActionTaskId));

  await toggleItemDone(ownerId, t2.id); // complete the last open task
  p = await getItem(ownerId, project.id);
  check("completing the last open task clears Next Action", p.nextActionTaskId === null, String(p.nextActionTaskId));

  // A non-pinned task completing must not touch the pin.
  const t3 = await make("task", "PJ5 third task");
  const t4 = await make("task", "PJ5 fourth task");
  await setHome(ownerId, t3.id, project.id, "project");
  await setHome(ownerId, t4.id, project.id, "project");
  await updateItem(ownerId, project.id, { nextActionTaskId: t3.id });
  await toggleItemDone(ownerId, t4.id); // complete a DIFFERENT task
  p = await getItem(ownerId, project.id);
  check("completing a non-pinned task leaves the pin alone", p.nextActionTaskId === t3.id, String(p.nextActionTaskId));
}

console.log("\n# milestones fan-out on a project");
{
  const project = await make("project", "PJ5 milestone project");
  const ms = await make("milestone", "Launch", { dueDate: new Date("2026-08-01T00:00:00.000Z") });
  await setHome(ownerId, ms.id, project.id, "contains");
  const fresh = await getItem(ownerId, project.id);
  const projectType = await getType("project");
  const { composition } = resolveComposition(fresh.composition, projectType.defaultWidgets, "project");
  const data = await resolveRecordWidgets(ownerId, fresh, composition);
  const milestones = data.find((d) => d.def.id === "milestones");
  check("the Milestones widget surfaces the contained milestone", milestones?.items?.some((i) => i.id === ms.id) ?? false);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of created) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
