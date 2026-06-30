// PJ8 / ADR-111 verification: the Overview weave. Pure: splitHeadStory,
// appendToStory, buildStorySkeleton. Live Neon: propose gathers only the events
// since the last weave; weaveStory appends to the Story, versions the body
// (revision snapshot), stamps overview_woven (advancing last_woven_at), and
// leaves the Head untouched. Cleans up. Run: npx tsx scripts/verify-overview-weave.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const { createItem, getItem, updateItem, listRevisions } = await import("../src/lib/items");
const { setHome } = await import("../src/lib/relations");
const { lastWovenAt } = await import("../src/lib/activity");
const { bodyMarkdown, makeMarkdownBody } = await import("../src/lib/body");
const { splitHeadStory, appendToStory, buildStorySkeleton, proposeStoryUpdate, weaveStory } = await import("../src/lib/overview/weave");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

console.log("\n# Pure: Head/Story split + append + skeleton");
{
  const { head, story } = splitHeadStory("Evergreen head.\n\n## Story\n\n- old line");
  check("split separates Head and Story", head === "Evergreen head." && story === "- old line");
  const noStory = splitHeadStory("Just a head.");
  check("no Story heading → all Head", noStory.head === "Just a head." && noStory.story === "");
  const created = appendToStory("Head only.", ["- a", "- b"]);
  check("append creates a Story heading when absent", /## Story/.test(created) && created.includes("- a") && created.includes("- b"));
  check("append keeps the Head intact", splitHeadStory(created).head === "Head only.");
  const appended = appendToStory("Head.\n\n## Story\n\n- a", ["- b"]);
  check("append under an existing Story heading adds, not duplicates", (appended.match(/## Story/g) ?? []).length === 1 && appended.includes("- a") && appended.includes("- b"));
  const skel = buildStorySkeleton([
    { summary: "later", occurredAt: new Date("2026-06-10T00:00:00Z") },
    { summary: "earlier", occurredAt: new Date("2026-06-01T00:00:00Z") },
  ]);
  check("skeleton is dated bullets, oldest first", skel.length === 2 && skel[0].includes("earlier") && skel[1].includes("later"));
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;
const created: string[] = [];
async function make(type: string, title: string) {
  const it = await createItem(ownerId, { type, title });
  created.push(it.id);
  return it;
}

console.log("\n# Live: propose + weave + version + clock");
{
  const project = await make("project", "PJ8 weave project"); // emits record_created
  // Give it an evergreen Head first.
  await updateItem(ownerId, project.id, { body: makeMarkdownBody("This project ships the thing.") });

  const before = await lastWovenAt(ownerId, project.id);
  check("last_woven_at is null before any weave", before === null);

  const proposal = await proposeStoryUpdate(ownerId, project.id);
  check("propose gathers the unwoven events (record_created)", proposal.eventCount >= 1 && proposal.skeleton.length >= 1, String(proposal.eventCount));

  await weaveStory(ownerId, project.id, proposal.skeleton);
  const after = await getItem(ownerId, project.id);
  check("the Head survives the weave", splitHeadStory(bodyMarkdown(after.body)).head.includes("ships the thing"));
  check("the Story now holds the woven lines", splitHeadStory(bodyMarkdown(after.body)).story.length > 0);
  const woven = await lastWovenAt(ownerId, project.id);
  check("weave advances last_woven_at", woven instanceof Date);

  // A new event after the weave is the ONLY thing proposed next.
  const task = await make("task", "PJ8 new task");
  await setHome(ownerId, task.id, project.id, "project"); // emits task_added (post-weave)
  const proposal2 = await proposeStoryUpdate(ownerId, project.id);
  check("propose after a weave gathers only the NEW events", proposal2.skeleton.some((l) => l.includes("task")) && !proposal2.skeleton.some((l) => l.includes("Created")), proposal2.skeleton.join(" | "));
}

console.log("\n# Live: a weave versions the body (fresh record, first body write)");
{
  const project = await make("project", "PJ8 versioning project");
  const revsBefore = (await listRevisions(ownerId, project.id)).length;
  const proposal = await proposeStoryUpdate(ownerId, project.id);
  await weaveStory(ownerId, project.id, proposal.skeleton);
  const revsAfter = (await listRevisions(ownerId, project.id)).length;
  check("the weave snapshotted a revision", revsAfter > revsBefore, `${revsBefore}→${revsAfter}`);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of [...created].reverse()) await db.delete(items).where(eq(items.id, id));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
