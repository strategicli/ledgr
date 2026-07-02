// PJ9 / ADR-111 verification: containment up — the Pursuit type + Related
// Records + derived roll-ups. Live Neon: a Pursuit routes to the widget canvas,
// contains Projects via home edges, surfaces them in Related Records (type-
// filtered), and its Progress / Recent Activity / Next Action roll up across the
// contained projects. Cleans up. Run: npx tsx scripts/verify-pursuit-rollup.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const { getItem } = await import("../src/lib/items");
const {
  createItem,
  toggleItemDone,
  updateItem,
} = await import("../src/lib/item-mutations");
const { setHome } = await import("../src/lib/relations");
const { homeParentOf } = await import("../src/lib/activity");
const { getType } = await import("../src/lib/types");
const { canvasIdForType } = await import("../src/lib/modules");
const { resolveComposition } = await import("../src/lib/composition");
const { resolveRecordWidgets } = await import("../src/lib/record-widgets");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const approx = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1e-9;

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string, extra: Record<string, unknown> = {}) {
  const it = await createItem(ownerId, { type, title, ...extra });
  created.push(it.id);
  return it;
}
const pursuitType = await getType("pursuit");
async function pursuitWidgets(pursuitId: string) {
  const fresh = await getItem(ownerId, pursuitId);
  const { composition } = resolveComposition(fresh.composition, pursuitType.defaultWidgets, "pursuit");
  return resolveRecordWidgets(ownerId, fresh, composition);
}

console.log("\n# pursuit type + routing");
{
  check("pursuit exists, not is_system", pursuitType.isSystem === false);
  check("pursuit routes to the widget canvas", canvasIdForType("pursuit", ownerId, pursuitType.capability) === "widgets", pursuitType.capability ?? "none");
  const def = resolveComposition(null, pursuitType.defaultWidgets, "pursuit").composition.widgets.map((w) => w.defId);
  check("pursuit default = relatedRecords + roll-up lenses", ["relatedRecords", "progress", "recentActivity", "nextAction"].every((id) => def.includes(id)), def.join(","));
}

console.log("\n# containment: a Pursuit contains Projects");
{
  const pursuit = await make("pursuit", "PJ9 pursuit");
  const projA = await make("project", "PJ9 project A");
  await setHome(ownerId, projA.id, pursuit.id, "contains");
  const parent = await homeParentOf(ownerId, projA.id);
  check("a Project's home parent can be a Pursuit", parent?.id === pursuit.id && parent?.type === "pursuit");
  const widgets = await pursuitWidgets(pursuit.id);
  const related = widgets.find((w) => w.def.id === "relatedRecords");
  check("Related Records (type-filtered) surfaces the contained project", related?.items?.some((i) => i.id === projA.id) ?? false);
}

console.log("\n# roll-up: Progress = average of the projects' fractions");
{
  const pursuit = await make("pursuit", "PJ9 rollup pursuit");
  const projA = await make("project", "PJ9 done project");
  const projB = await make("project", "PJ9 empty project");
  await setHome(ownerId, projA.id, pursuit.id, "contains");
  await setHome(ownerId, projB.id, pursuit.id, "contains");
  // Project A: one task, done → A fraction 1.0. Project B: one open task → 0.0.
  const tA = await make("task", "PJ9 A task");
  await setHome(ownerId, tA.id, projA.id, "project");
  await toggleItemDone(ownerId, tA.id);
  const tB = await make("task", "PJ9 B task");
  await setHome(ownerId, tB.id, projB.id, "project");

  const widgets = await pursuitWidgets(pursuit.id);
  const prog = widgets.find((w) => w.def.id === "progress")?.progress;
  check("Pursuit Progress = avg(1.0, 0.0) = 0.5", approx(prog?.fraction, 0.5), JSON.stringify(prog));
  check("Pursuit Progress done/total = 1/2 projects complete", prog?.done === 1 && prog?.total === 2);

  const activity = widgets.find((w) => w.def.id === "recentActivity")?.activity ?? [];
  check("Recent Activity rolls up a project's task_completed", activity.some((e) => e.kind === "task_completed"), activity.map((e) => e.kind).join(","));

  // Next Action roll-up: pursuit has none of its own → surfaces a project's.
  await updateItem(ownerId, projB.id, { nextActionText: "kick off B" });
  const widgets2 = await pursuitWidgets(pursuit.id);
  const na = widgets2.find((w) => w.def.id === "nextAction")?.nextAction;
  check("Next Action rolls up the first project's next step", na?.text === "kick off B", JSON.stringify(na));
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of [...created].reverse()) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
