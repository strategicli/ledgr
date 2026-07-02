// PJ11 / ADR-111 verification: the Timeline + Mindmap widgets. Live Neon: the
// Timeline overlays the record's Meetings + Milestones by date; the Mindmap
// widget surfaces the record's contained mindmap(s) (it reuses MindmapCanvas via
// the contained-item link — v2 node-promotion is deferred). Cleans up.
// Run: npx tsx scripts/verify-graph-widgets.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const { getItem } = await import("../src/lib/items");
const { createItem } = await import("../src/lib/item-mutations");
const { setHome } = await import("../src/lib/relations");
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
const comp = (defIds: string[]) => ({ version: 1 as const, widgets: defIds.map((d) => ({ instanceId: d, defId: d })), behaviors: {} });

console.log("\n# Timeline overlays Meetings + Milestones by date");
{
  const project = await make("project", "PJ11 timeline project");
  const event = await make("event", "PJ11 kickoff meeting", { meetingAt: new Date("2026-07-05T15:00:00Z") });
  await setHome(ownerId, event.id, project.id, "contains");
  const ms = await make("milestone", "PJ11 launch", { dueDate: new Date("2026-07-02T00:00:00Z") });
  await setHome(ownerId, ms.id, project.id, "contains");

  const fresh = await getItem(ownerId, project.id);
  const data = await resolveRecordWidgets(ownerId, fresh, comp(["timeline"]));
  const tl = data.find((d) => d.def.id === "timeline")?.timeline ?? [];
  check("timeline includes both the meeting and the milestone", tl.some((e) => e.id === event.id && e.kind === "meeting") && tl.some((e) => e.id === ms.id && e.kind === "milestone"), `${tl.length} entries`);
  check("timeline is sorted by date (milestone Jul 2 before meeting Jul 5)", tl.length === 2 && tl[0].id === ms.id && tl[1].id === event.id);
}

console.log("\n# Mindmap widget surfaces the contained mindmap");
{
  const project = await make("project", "PJ11 mindmap project");
  const mind = await make("mindmap", "PJ11 brainstorm");
  await setHome(ownerId, mind.id, project.id, "contains");
  const fresh = await getItem(ownerId, project.id);
  const data = await resolveRecordWidgets(ownerId, fresh, comp(["mindmap"]));
  const mm = data.find((d) => d.def.id === "mindmap");
  check("the Mindmap widget lists the contained mindmap (links to its canvas)", mm?.items?.some((i) => i.id === mind.id) ?? false);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of [...created].reverse()) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
