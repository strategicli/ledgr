// Slice 24 verification: meeting prep assembly + action-item promotion against
// the live Neon DB under a throwaway owner. Covers person gathering (confirmed
// only), the person's open tasks (done/other-person tasks excluded), recent
// meetings (this one excluded, capped, newest first), default agenda, and
// promotion (task created + related to the meeting and its people, so it then
// shows up in prep). Run: npx tsx scripts/verify-meeting-prep.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const { getMeetingPrep } = await import("../src/lib/meetings/prep");
const { promoteActionItem } = await import("../src/lib/meetings/promote");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-prep-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

const mk = async (v: Record<string, unknown>) =>
  (await db.insert(items).values({ ownerId, ...(v as object) } as typeof items.$inferInsert).returning({ id: items.id }))[0].id;
const relate = (s: string, t: string, state: "confirmed" | "suggested" = "confirmed") =>
  db.insert(relations).values({ sourceId: s, targetId: t, role: "related", matchState: state });

try {
  const roger = await mk({ type: "person", title: "Roger" });
  const other = await mk({ type: "person", title: "Someone Else" });
  const meeting = await mk({ type: "meeting", title: "Roger 1:1", meetingAt: new Date("2026-06-20T15:00:00Z") });

  // Roger's tasks: one open (should appear), one done (excluded), plus a task
  // for the OTHER person (excluded). And a suggested edge that must not count.
  const openTask = await mk({ type: "task", title: "Prep budget memo", status: "open", dueDate: new Date("2026-06-19T00:00:00Z") });
  const doneTask = await mk({ type: "task", title: "Already finished", status: "done" });
  const otherTask = await mk({ type: "task", title: "Not Roger's", status: "open" });
  const suggestedTask = await mk({ type: "task", title: "Only suggested-linked", status: "open" });
  await relate(openTask, roger);
  await relate(doneTask, roger);
  await relate(otherTask, other);
  await relate(suggestedTask, roger, "suggested");

  // Past meetings with Roger: three older + one in the future; this meeting
  // (also Roger's) must be excluded from "recent".
  const past1 = await mk({ type: "meeting", title: "1:1 May", meetingAt: new Date("2026-05-01T15:00:00Z") });
  const past2 = await mk({ type: "meeting", title: "1:1 Apr", meetingAt: new Date("2026-04-01T15:00:00Z") });
  const past3 = await mk({ type: "meeting", title: "1:1 Mar", meetingAt: new Date("2026-03-01T15:00:00Z") });
  const past4 = await mk({ type: "meeting", title: "1:1 Feb", meetingAt: new Date("2026-02-01T15:00:00Z") });
  for (const m of [meeting, past1, past2, past3, past4]) await relate(m, roger);

  // Relate the person to the meeting as well (the meeting<->Roger edge).
  // (meeting already related above.)

  const prep = await getMeetingPrep(ownerId, meeting);
  check("gathers the confirmed person", prep.people.length === 1 && prep.people[0].id === roger);
  check(
    "open tasks: only Roger's open task (done/other-person/suggested excluded)",
    prep.openTasks.length === 1 && prep.openTasks[0].id === openTask,
    prep.openTasks.map((t) => t.title).join(", ")
  );
  check("recent meetings exclude this meeting and cap at 3", prep.recentMeetings.length === 3 && !prep.recentMeetings.some((m) => m.id === meeting));
  check(
    "recent meetings are newest-first",
    prep.recentMeetings[0].id === past1 && prep.recentMeetings[2].id === past3,
    prep.recentMeetings.map((m) => m.title).join(" > ")
  );
  check("default agenda present", prep.agenda.length > 0);

  // --- empty prep (no related person) -------------------------------------
  const lonelyMeeting = await mk({ type: "meeting", title: "Solo block" });
  const emptyPrep = await getMeetingPrep(ownerId, lonelyMeeting);
  check("a meeting with no people yields empty prep + default agenda", emptyPrep.people.length === 0 && emptyPrep.openTasks.length === 0 && emptyPrep.agenda.length > 0);

  // --- action-item -> task promotion --------------------------------------
  const task = await promoteActionItem(ownerId, meeting, "  Follow up on the memo  ");
  check("promotion creates a trimmed, open, non-inbox task", task.type === "task" && task.title === "Follow up on the memo" && task.status === "open" && task.inbox === false);
  const taskRels = await db
    .select({ targetId: relations.targetId, sourceId: relations.sourceId })
    .from(relations)
    .where(eq(relations.sourceId, task.id));
  const relatedIds = new Set(taskRels.flatMap((r) => [r.targetId, r.sourceId]));
  check("promoted task is related to the meeting and the person", relatedIds.has(meeting) && relatedIds.has(roger));

  // The promoted task should now appear in this person's prep open tasks.
  const prep2 = await getMeetingPrep(ownerId, meeting);
  check("promoted task shows up in the next prep read", prep2.openTasks.some((t) => t.id === task.id));

  // --- owner scoping ------------------------------------------------------
  const [otherUser] = await db.insert(users).values({ email: `verify-prep-other-${Date.now()}@example.invalid` }).returning({ id: users.id });
  let crossOwnerEmpty = false;
  try {
    const cross = await getMeetingPrep(otherUser.id, meeting);
    crossOwnerEmpty = cross.people.length === 0 && cross.openTasks.length === 0;
  } finally {
    await db.delete(users).where(eq(users.id, otherUser.id));
  }
  check("prep is owner-scoped (other owner sees nothing for this meeting)", crossOwnerEmpty);
} finally {
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
