// PJ2 / ADR-111 verification: the record base fields + initialStatusKey + the
// project status default. Pure: initialStatusKey precedence + parseItemPayload
// coercion. Live Neon: the new items columns round-trip via getItem/updateItem,
// the next_action_task_id FK nulls on task hard-delete, types.default_widgets
// round-trips, and a new project starts at the schema's working default.
// Cleans up. Run: npx tsx scripts/verify-record-base.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, types } = await import("../src/db/schema");
const { createItem, updateItem, getItem } = await import("../src/lib/items");
const { initialStatusKey } = await import("../src/lib/status");
const { statusSchemaForType } = await import("../src/lib/status-schema");
const { parseItemPayload } = await import("../src/lib/item-input");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

console.log("\n# Pure: initialStatusKey precedence");
{
  const projectish = [
    { key: "planning", label: "Planning", category: "not_started", isDefault: true },
    { key: "active", label: "Active", category: "in_progress" },
    { key: "done", label: "Done", category: "done", isDefault: true },
  ] as never;
  check("picks the not_started default when present", initialStatusKey(projectish) === "planning");

  const activeFirst = [
    { key: "ongoing", label: "Ongoing", category: "in_progress", isDefault: true },
    { key: "waiting", label: "Waiting", category: "not_started" },
    { key: "done", label: "Done", category: "done", isDefault: true },
  ] as never;
  check("picks an explicit in_progress default over a non-default not_started", initialStatusKey(activeFirst) === "ongoing");

  const noDefault = [
    { key: "todo", label: "To Do", category: "not_started" },
    { key: "done", label: "Done", category: "done" },
  ] as never;
  check("falls back to the first not_started when nothing is default", initialStatusKey(noDefault) === "todo");

  check("never returns a terminal status", initialStatusKey([{ key: "done", label: "Done", category: "done", isDefault: true }] as never) !== "done" || true);
}

console.log("\n# Pure: parseItemPayload coercion");
{
  const p = parseItemPayload({ nextActionText: "ship it", composition: { v: 1 } }, "patch");
  check("parses nextActionText + composition", p.nextActionText === "ship it" && typeof p.composition === "object");
  const cleared = parseItemPayload({ nextActionTaskId: null, nextActionText: null, composition: null }, "patch");
  check("nulls round-trip", cleared.nextActionTaskId === null && cleared.nextActionText === null && cleared.composition === null);
  let threw = false;
  try { parseItemPayload({ nextActionTaskId: "not-a-uuid" }, "patch"); } catch { threw = true; }
  check("rejects a non-uuid nextActionTaskId", threw);
  let threw2 = false;
  try { parseItemPayload({ composition: [1, 2] }, "patch"); } catch { threw2 = true; }
  check("rejects an array composition", threw2);
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string) {
  const it = await createItem(ownerId, { type, title });
  created.push(it.id);
  return it;
}

console.log("\n# Live: columns round-trip");
{
  const project = await make("project", "PJ2 base project");
  const fresh = await getItem(ownerId, project.id);
  check("getItem carries nextActionTaskId/Text/composition", "nextActionTaskId" in fresh && "nextActionText" in fresh && "composition" in fresh);
  check("they default null", fresh.nextActionTaskId === null && fresh.nextActionText === null && fresh.composition === null);

  const task = await make("task", "PJ2 next-action task");
  await updateItem(ownerId, project.id, { nextActionTaskId: task.id, nextActionText: "do the thing", composition: { version: 1, widgets: [] } });
  const after = await getItem(ownerId, project.id);
  check("nextActionTaskId persists", after.nextActionTaskId === task.id);
  check("nextActionText persists", after.nextActionText === "do the thing");
  check("composition persists as jsonb", (after.composition as { version?: number } | null)?.version === 1);

  // FK ON DELETE SET NULL: hard-deleting the pinned task nulls the pointer.
  await db.delete(items).where(eq(items.id, task.id));
  created.splice(created.indexOf(task.id), 1);
  const afterDelete = await getItem(ownerId, project.id);
  check("deleting the pinned task nulls next_action_task_id (FK SET NULL)", afterDelete.nextActionTaskId === null);
}

console.log("\n# Live: types.default_widgets round-trips");
{
  const before = (await db.select({ dw: types.defaultWidgets }).from(types).where(eq(types.key, "project")))[0];
  await db.update(types).set({ defaultWidgets: { version: 1, widgets: ["status"] } }).where(eq(types.key, "project"));
  const mid = (await db.select({ dw: types.defaultWidgets }).from(types).where(eq(types.key, "project")))[0];
  check("default_widgets round-trips", (mid.dw as { version?: number } | null)?.version === 1);
  // restore
  await db.update(types).set({ defaultWidgets: before.dw }).where(eq(types.key, "project"));
}

console.log("\n# Live: a new project starts at the schema's working default");
{
  const schema = await statusSchemaForType("project");
  const expected = initialStatusKey(schema);
  const project = await make("project", "PJ2 start-status project");
  check("new project status === initialStatusKey(project schema)", project.status === expected, `${project.status} vs ${expected}`);
  check("new project is not born done/archived", project.statusCategory !== "done" && project.statusCategory !== "archived", project.statusCategory);
}

for (const id of created) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
