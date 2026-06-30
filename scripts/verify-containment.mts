// PJ1 / ADR-111 verification: containment via the relations.home flag + setHome.
// Live Neon: setHome marks a primary residence; homeParentOf resolves it; the
// one-home-per-source invariant holds (a second setHome clears the first); a
// home edge surfaces in the Related panel carrying home; containment emits the
// right activity line on a tracked parent; owner-scoping rejects foreign items.
// Cleans up everything it creates. Run: npx tsx scripts/verify-containment.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, relations, activityEvents } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/items");
const { setHome, relateItems, listRelatedItems } = await import("../src/lib/relations");
const { homeParentOf, listActivity } = await import("../src/lib/activity");
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

console.log("\n# setHome + homeParentOf");
{
  const projectA = await make("project", "PJ1 containment project A");
  const task = await make("task", "PJ1 contained task");
  await setHome(ownerId, task.id, projectA.id, "project");
  const parent = await homeParentOf(ownerId, task.id);
  check("homeParentOf resolves the home parent", parent?.id === projectA.id, String(parent?.id));
  check("home parent carries its type", parent?.type === "project");

  const edges = await db
    .select({ home: relations.home, role: relations.role })
    .from(relations)
    .where(eq(relations.sourceId, task.id));
  check("the home edge is stored home=true", edges.some((e) => e.home === true && e.role === "project"));
}

console.log("\n# one-home-per-source invariant");
{
  const projA = await make("project", "PJ1 home A");
  const projB = await make("project", "PJ1 home B");
  const task = await make("task", "PJ1 movable task");
  await setHome(ownerId, task.id, projA.id, "project");
  await setHome(ownerId, task.id, projB.id, "project");
  const parent = await homeParentOf(ownerId, task.id);
  check("a second setHome moves the home to the new parent", parent?.id === projB.id, String(parent?.id));
  const homeEdges = await db
    .select({ id: relations.id })
    .from(relations)
    .where(eq(relations.sourceId, task.id));
  const homeCount = (
    await db.select({ home: relations.home }).from(relations).where(eq(relations.sourceId, task.id))
  ).filter((e) => e.home).length;
  check("exactly one home edge remains (invariant)", homeCount === 1, `${homeCount} home of ${homeEdges.length} edges`);
}

console.log("\n# relateItems({home}) + Related panel carries home");
{
  const proj = await make("project", "PJ1 relate-home project");
  const note = await make("note", "PJ1 relate-home note");
  await relateItems(ownerId, note.id, proj.id, "contains", { home: true });
  const parent = await homeParentOf(ownerId, note.id);
  check("relateItems with home:true sets the home parent", parent?.id === proj.id);
  // Related panel (direction-blind) on the note should carry the home flag.
  const related = await listRelatedItems(ownerId, note.id);
  const row = related.find((r) => r.id === proj.id) as { home?: boolean } | undefined;
  check("the Related panel row carries home", row?.home === true);
}

console.log("\n# containment emits the right activity line on a tracked parent");
{
  const proj = await make("project", "PJ1 activity project");
  const task = await make("task", "PJ1 activity task");
  await setHome(ownerId, task.id, proj.id, "project");
  const log = await listActivity(ownerId, proj.id);
  check("setHome emits task_added on the parent", log.some((e) => e.kind === "task_added" && e.actorId === task.id), log.map((e) => e.kind).join(","));

  // A non-tracked parent (note) gets NO containment activity.
  const noteParent = await make("note", "PJ1 non-tracked parent");
  const child = await make("task", "PJ1 child of note");
  await setHome(ownerId, child.id, noteParent.id, "contains");
  const noteLog = await listActivity(ownerId, noteParent.id);
  check("a non-tracked parent logs no containment event", noteLog.length === 0);
}

console.log("\n# owner-scoping");
{
  const proj = await make("project", "PJ1 scope project");
  let threw = false;
  try {
    await setHome(ownerId, "00000000-0000-0000-0000-000000000000", proj.id, "contains");
  } catch {
    threw = true;
  }
  check("setHome rejects a foreign/missing child", threw);

  let selfThrew = false;
  try {
    await setHome(ownerId, proj.id, proj.id, "contains");
  } catch {
    selfThrew = true;
  }
  check("setHome rejects a self-containment", selfThrew);
}

// Cleanup: drop activity (cascade covers subject; be explicit anyway), then items.
await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of created) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
