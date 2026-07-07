// ADR-144 Phase 3 verification: getMissedMeetings + its surfacing in prep.
// Under a throwaway owner, mark a person OUT of a past meeting and confirm it
// shows as a "missed" meeting for a 1:1 with that person — but a future meeting,
// a here-marked meeting, and another owner's data do not.
// Run: npx tsx scripts/verify-missed-meetings.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { setAttendance, getMissedMeetings } = await import("../src/lib/events/people");
const { getMeetingPrep } = await import("../src/lib/meetings/prep");
const { eq } = await import("drizzle-orm");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
  if (ok) pass++;
  else fail++;
}

const db = getDb();
const [u] = await db
  .insert(users)
  .values({ email: `verify-missed-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = u.id;
const past = new Date(Date.now() - 7 * 864e5);
const future = new Date(Date.now() + 7 * 864e5);
const mk = async (v: Record<string, unknown>) =>
  (await db.insert(items).values({ ownerId, ...(v as object) } as typeof items.$inferInsert).returning({ id: items.id }))[0].id;

try {
  const roger = await mk({ type: "person", title: "Roger" });
  const pastorsMtg = await mk({ type: "event", title: "All Pastors Meeting", meetingAt: past });
  const futureMtg = await mk({ type: "event", title: "Future All Pastors", meetingAt: future });
  const heldMtg = await mk({ type: "event", title: "Elders Meeting", meetingAt: past });
  const oneOnOne = await mk({ type: "event", title: "Roger 1:1", meetingAt: new Date() });

  // Roger: OUT of the past pastors meeting + a future one; HERE at the elders one.
  await setAttendance(ownerId, pastorsMtg, roger, "absent");
  await setAttendance(ownerId, futureMtg, roger, "absent");
  await setAttendance(ownerId, heldMtg, roger, "here");
  // And Roger attends the 1:1 we're prepping.
  await setAttendance(ownerId, oneOnOne, roger, "here");

  const missed = await getMissedMeetings(ownerId, [roger]);
  check(
    "surfaces the past meeting Roger was OUT of",
    missed.some((m) => m.meetingId === pastorsMtg),
    missed.map((m) => m.meetingTitle).join(", ")
  );
  check("does NOT surface a future missed meeting", !missed.some((m) => m.meetingId === futureMtg));
  check("does NOT surface a meeting Roger attended", !missed.some((m) => m.meetingId === heldMtg));
  check("the missed row carries the person's name", missed[0]?.personTitle === "Roger");

  // In the 1:1's prep, the missed meeting shows and excludes the 1:1 itself.
  const prep = await getMeetingPrep(ownerId, oneOnOne);
  check(
    "prep.missedMeetings surfaces the pastors meeting",
    prep.missedMeetings.some((m) => m.meetingId === pastorsMtg)
  );
  check(
    "prep excludes the event being prepped",
    !prep.missedMeetings.some((m) => m.meetingId === oneOnOne)
  );

  // Owner-scoping: another owner sees none of this.
  const [u2] = await db
    .insert(users)
    .values({ email: `verify-missed-other-${Date.now()}@example.invalid` })
    .returning({ id: users.id });
  const crossMissed = await getMissedMeetings(u2.id, [roger]);
  check("owner-scoped (other owner sees no missed meetings)", crossMissed.length === 0);
  await db.delete(users).where(eq(users.id, u2.id));
} finally {
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(fail === 0 ? `\nAll ${pass} checks passed.` : `\n${fail} check(s) FAILED.`);
process.exit(fail === 0 ? 0 : 1);
