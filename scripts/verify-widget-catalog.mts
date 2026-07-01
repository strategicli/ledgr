// PJ3 / ADR-111 verification: the widget registry (Layer 1), the composition
// parse/resolve overlay (Layer 2/3), and the home-scoped relatedTo refinement.
// Pure: availability is derived (every catalog widget on every type, zero
// authoring); composition parses tolerantly and overlays record → type →
// generated. Live Neon: a record-scoped query with relatedHome shows only the
// home-edge children, and relatedRole scopes by edge role. Cleans up.
// Run: npx tsx scripts/verify-widget-catalog.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const { WIDGET_CATALOG, availableWidgets, widgetsForScope, widgetById } = await import("../src/lib/widgets");
const { parseComposition, resolveComposition, generatedDefaultComposition, addableWidgets, isWidgetEnabled } = await import("../src/lib/composition");
const { createItem } = await import("../src/lib/items");
const { setHome, relateItems } = await import("../src/lib/relations");
const { queryViewItems } = await import("../src/lib/views");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

console.log("\n# Layer 1: derived availability (zero authoring)");
{
  check("a brand-new/unknown type gets the WHOLE catalog", availableWidgets("songsheet").length === WIDGET_CATALOG.length, `${availableWidgets("songsheet").length}/${WIDGET_CATALOG.length}`);
  check("project gets the whole catalog too", availableWidgets("project").length === WIDGET_CATALOG.length);
  const recordScoped = widgetsForScope("record").map((w) => w.id);
  const queryScoped = widgetsForScope("query").map((w) => w.id);
  check("record-only widgets exist (relatedRecords/mindmap/timeline)", ["relatedRecords", "mindmap", "timeline"].every((id) => recordScoped.includes(id) && !queryScoped.includes(id)));
  check("tasks/notes run in BOTH scopes (one catalog, two surfaces)", ["tasks", "notes"].every((id) => recordScoped.includes(id) && queryScoped.includes(id)));
  check("every catalog id resolves via widgetById", WIDGET_CATALOG.every((w) => widgetById(w.id)?.id === w.id));
}

console.log("\n# Layer 2: generated default composition");
{
  const proj = generatedDefaultComposition("project");
  const ids = proj.widgets.map((w) => w.defId);
  check("project default has the redesigned widgets (header + cards)", ["status", "people", "progress", "tasks", "milestones", "notes", "meetings"].every((id) => ids.includes(id)), ids.join(","));
  check("project default turns Digest on", proj.behaviors.digest?.enabled === true && proj.behaviors.digest.stalenessDays === 7);
  const generic = generatedDefaultComposition("songsheet");
  check("a generic type default is minimal (overview + status), Digest off", generic.widgets.map((w) => w.defId).sort().join(",") === "overview,status" && !generic.behaviors.digest);
}

console.log("\n# Layer 3: tolerant parse + overlay + gear helpers");
{
  check("bad shape → null", parseComposition({ nope: 1 }) === null && parseComposition(null) === null);
  const parsed = parseComposition({ version: 1, widgets: [{ defId: "tasks" }, { defId: "tasks" }, { defId: "not_a_widget" }, { defId: "notes", hidden: true }], behaviors: { digest: { enabled: false, stalenessDays: 3, upcomingDays: 99 } } });
  check("dedupes by instanceId (two bare tasks → one)", parsed!.widgets.filter((w) => w.defId === "tasks").length === 1);
  const resolved = resolveComposition({ version: 1, widgets: [{ defId: "tasks" }, { defId: "not_a_widget" }, { defId: "notes", hidden: true }] }, null, "project");
  check("reconcile drops unknown widget ids", !resolved.composition.widgets.some((w) => w.defId === "not_a_widget"));
  check("hidden flag is preserved (hide-not-delete)", resolved.composition.widgets.find((w) => w.defId === "notes")?.hidden === true);
  check("resolve source = record when the record has a composition", resolved.source === "record");
  check("resolve falls back to type default", resolveComposition(null, { version: 1, widgets: [{ defId: "overview" }] }, "project").source === "type");
  check("resolve falls back to generated", resolveComposition(null, null, "project").source === "generated");
  check("isWidgetEnabled: notes is hidden → not enabled, tasks → enabled", !isWidgetEnabled(resolved.composition, "notes") && isWidgetEnabled(resolved.composition, "tasks"));
  const addable = addableWidgets(resolved.composition, availableWidgets("project"));
  check("addableWidgets excludes present (incl. hidden) widgets", !addable.includes("tasks") && !addable.includes("notes") && addable.includes("people"));
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string) {
  const it = await createItem(ownerId, { type, title });
  created.push(it.id);
  return it;
}

console.log("\n# Live: home-scoped relatedTo refinement (the record-scope query)");
{
  const project = await make("project", "PJ3 widget project");
  const homeTask = await make("task", "PJ3 contained task");
  const relatedTask = await make("task", "PJ3 merely-related task");
  await setHome(ownerId, homeTask.id, project.id, "project"); // home edge, role project
  await relateItems(ownerId, relatedTask.id, project.id, "related"); // non-home, other role

  const all = await queryViewItems(ownerId, { type: "task", relatedTo: project.id }, { field: "updatedAt", dir: "desc" });
  check("relatedTo (no home) returns BOTH tasks", all.some((r) => r.id === homeTask.id) && all.some((r) => r.id === relatedTask.id), `${all.length} found`);

  const homeOnly = await queryViewItems(ownerId, { type: "task", relatedTo: project.id, relatedHome: true }, { field: "updatedAt", dir: "desc" });
  check("relatedHome returns ONLY the contained (home) task", homeOnly.some((r) => r.id === homeTask.id) && !homeOnly.some((r) => r.id === relatedTask.id), `${homeOnly.length} found`);

  const byRole = await queryViewItems(ownerId, { type: "task", relatedTo: project.id, relatedHome: true, relatedRole: "project" }, { field: "updatedAt", dir: "desc" });
  check("relatedRole scopes to the edge role", byRole.some((r) => r.id === homeTask.id));

  const wrongRole = await queryViewItems(ownerId, { type: "task", relatedTo: project.id, relatedHome: true, relatedRole: "contains" }, { field: "updatedAt", dir: "desc" });
  check("a non-matching relatedRole returns nothing", wrongRole.length === 0, `${wrongRole.length} found`);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of created) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
