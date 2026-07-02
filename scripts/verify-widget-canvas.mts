// PJ4 / ADR-111 verification: the widget canvas resolution + fan-out + the
// gear's persistence contract. Live Neon: a new project is "born" with the §8
// default widgets (Layer 2/generated); the fan-out binds each widget to the
// record (the Tasks widget shows the contained task, not an unrelated one);
// disabling a widget HIDES it (data untouched) and re-enabling restores; the
// project type routes to the widgets canvas. Cleans up.
// Run: npx tsx scripts/verify-widget-canvas.mts
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
  updateItem,
} = await import("../src/lib/item-mutations");
const { setHome, relateItems } = await import("../src/lib/relations");
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

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string) {
  const it = await createItem(ownerId, { type, title });
  created.push(it.id);
  return it;
}

const projectType = await getType("project");

console.log("\n# project routes to the widgets canvas");
check("canvasIdForType(project) = widgets", canvasIdForType("project", ownerId, projectType.capability) === "widgets", projectType.capability ?? "no capability");

console.log("\n# born with the §8 default widgets");
{
  const project = await make("project", "PJ4 canvas project");
  const fresh = await getItem(ownerId, project.id);
  const { composition, source } = resolveComposition(fresh.composition, projectType.defaultWidgets, "project");
  check("a fresh project has no stored composition (inherits)", source !== "record");
  const defIds = composition.widgets.map((w) => w.defId);
  check("default includes the redesigned project set (header + cards)", ["status", "people", "progress", "tasks", "milestones", "notes", "meetings"].every((id) => defIds.includes(id)), defIds.join(","));
  const data = await resolveRecordWidgets(ownerId, fresh, composition);
  check("fan-out returns data for every visible widget", data.length === composition.widgets.filter((w) => !w.hidden).length);
  check("progress is indeterminate with no tasks", data.find((d) => d.def.id === "progress")?.progress?.fraction === null);
}

console.log("\n# fan-out binds to the record (anything associated, any role)");
{
  const project = await make("project", "PJ4 bind project");
  const homeTask = await make("task", "PJ4 contained task");
  const otherTask = await make("task", "PJ4 related task");
  await setHome(ownerId, homeTask.id, project.id, "project");
  await relateItems(ownerId, otherTask.id, project.id, "related");

  const fresh = await getItem(ownerId, project.id);
  const { composition } = resolveComposition(fresh.composition, projectType.defaultWidgets, "project");
  const data = await resolveRecordWidgets(ownerId, fresh, composition);
  const tasksWidget = data.find((d) => d.def.id === "tasks");
  // The box shows ANYTHING of that type associated with the record, however it
  // was linked (home "project" edge OR a plain "related" edge) — Tyler's rule.
  check("Tasks widget shows the contained task", tasksWidget?.items?.some((i) => i.id === homeTask.id) ?? false);
  check("Tasks widget also shows the merely-related task", tasksWidget?.items?.some((i) => i.id === otherTask.id) ?? false);
  const progress = data.find((d) => d.def.id === "progress")?.progress;
  // Weighted points: two not-done leaf tasks = 3 pts each = 6 pts total, 0 done.
  check("progress counts both associated tasks (0/6 pts)", progress?.done === 0 && progress?.total === 6, JSON.stringify(progress));
}

console.log("\n# gear: disable hides (data kept), re-enable restores");
{
  const project = await make("project", "PJ4 toggle project");
  const task = await make("task", "PJ4 toggle task");
  await setHome(ownerId, task.id, project.id, "project");

  // Materialize the resolved composition with Tasks hidden (what the gear PATCHes).
  let fresh = await getItem(ownerId, project.id);
  const { composition } = resolveComposition(fresh.composition, projectType.defaultWidgets, "project");
  const hidden = {
    ...composition,
    widgets: composition.widgets.map((w) => (w.defId === "tasks" ? { ...w, hidden: true } : w)),
  };
  await updateItem(ownerId, project.id, { composition: hidden });

  fresh = await getItem(ownerId, project.id);
  const r1 = resolveComposition(fresh.composition, projectType.defaultWidgets, "project");
  check("composition now stored on the record (Layer 3)", r1.source === "record");
  const data1 = await resolveRecordWidgets(ownerId, fresh, r1.composition);
  check("hidden Tasks widget is not rendered", !data1.some((d) => d.def.id === "tasks"));
  const taskStillThere = await getItem(ownerId, task.id);
  check("the contained task ITEM is untouched (hide, not delete)", taskStillThere.deletedAt === null);

  // Re-enable.
  const shown = {
    ...r1.composition,
    widgets: r1.composition.widgets.map((w) => (w.defId === "tasks" ? { ...w, hidden: false } : w)),
  };
  await updateItem(ownerId, project.id, { composition: shown });
  fresh = await getItem(ownerId, project.id);
  const r2 = resolveComposition(fresh.composition, projectType.defaultWidgets, "project");
  const data2 = await resolveRecordWidgets(ownerId, fresh, r2.composition);
  const tasksWidget = data2.find((d) => d.def.id === "tasks");
  check("re-enabling restores the Tasks widget WITH its task", tasksWidget?.items?.some((i) => i.id === task.id) ?? false);

  // Reset to type default (gear's reset = composition null).
  await updateItem(ownerId, project.id, { composition: null });
  fresh = await getItem(ownerId, project.id);
  check("reset clears the record composition", fresh.composition === null);
}

console.log("\n# nextAction + recentActivity read the base/log");
{
  const project = await make("project", "PJ4 derived project");
  await updateItem(ownerId, project.id, { nextActionText: "call the printer" });
  const fresh = await getItem(ownerId, project.id);
  const { composition } = resolveComposition(fresh.composition, projectType.defaultWidgets, "project");
  // nextAction and recentActivity are both off the redesigned project default —
  // add them so the derived fan-out reads the base (nextAction) + the log.
  composition.widgets.push({ instanceId: "nextAction", defId: "nextAction" });
  composition.widgets.push({ instanceId: "recentActivity", defId: "recentActivity" });
  const data = await resolveRecordWidgets(ownerId, fresh, composition);
  check("nextAction widget surfaces the text", data.find((d) => d.def.id === "nextAction")?.nextAction?.text === "call the printer");
  check("recentActivity has the record_created line", (data.find((d) => d.def.id === "recentActivity")?.activity?.length ?? 0) >= 1);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of created) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
