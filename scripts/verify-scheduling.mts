// T2 verification (ADR-073): scheduling + rescheduling. Two halves:
//   1. The PURE natural-language date parser (nl-date.ts) — relative to a fixed
//      reference today, every grammar shape + the rejection path.
//   2. The overdue auto-roll (scheduling.ts) against live Neon: only open,
//      non-recurring, past-scheduled tasks roll to today; recurring/future/done
//      are left alone; owner scoping; the count matches the roll.
// Run: npx tsx scripts/verify-scheduling.mts   (safe to delete once T2 closes)
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { parseNaturalDate } = await import("../src/lib/nl-date");
const { makeRecurrence } = await import("../src/lib/recurrence");

let failures = 0;
function eq<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  if (!ok) failures += 1;
}
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// Reference today: Wednesday, 2026-06-17.
const T = "2026-06-17";
console.log("\n# Pure: natural-language dates (today = Wed 2026-06-17)");
eq("today", parseNaturalDate("today", T), "2026-06-17");
eq("tomorrow", parseNaturalDate("Tomorrow", T), "2026-06-18");
eq("tonight", parseNaturalDate("tonight", T), "2026-06-17");
eq("yesterday", parseNaturalDate("yesterday", T), "2026-06-16");
eq("in 3 days", parseNaturalDate("in 3 days", T), "2026-06-20");
eq("bare '3 days'", parseNaturalDate("3 days", T), "2026-06-20");
eq("2 weeks", parseNaturalDate("2 weeks", T), "2026-07-01");
eq("in 1 month", parseNaturalDate("in 1 month", T), "2026-07-17");
eq("next week", parseNaturalDate("next week", T), "2026-06-24");
eq("next month", parseNaturalDate("next month", T), "2026-07-17");
eq("friday (this week)", parseNaturalDate("friday", T), "2026-06-19");
eq("next friday (+1 week)", parseNaturalDate("next friday", T), "2026-06-26");
eq("wednesday = today", parseNaturalDate("wednesday", T), "2026-06-17");
eq("next wednesday (+1 week)", parseNaturalDate("next wednesday", T), "2026-06-24");
eq("monday (upcoming)", parseNaturalDate("mon", T), "2026-06-22");
eq("weekend = Saturday", parseNaturalDate("weekend", T), "2026-06-20");
eq("jun 20", parseNaturalDate("jun 20", T), "2026-06-20");
eq("june 20 2026 (explicit year)", parseNaturalDate("june 20 2026", T), "2026-06-20");
eq("20 jun (day-month)", parseNaturalDate("20 jun", T), "2026-06-20");
eq("past month/day rolls to next year", parseNaturalDate("jun 16", T), "2027-06-16");
eq("m/d slash", parseNaturalDate("6/20", T), "2026-06-20");
eq("m/d/yy", parseNaturalDate("12/25/26", T), "2026-12-25");
eq("ISO passthrough", parseNaturalDate("2026-12-25", T), "2026-12-25");
eq("gibberish → null", parseNaturalDate("someday maybe", T), null);
eq("empty → null", parseNaturalDate("", T), null);
eq("bad ISO day → null", parseNaturalDate("2026-02-30", T), null);

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/item-mutations");
const { rollOverdueScheduled, countOverdueScheduled } = await import("../src/lib/scheduling");
const { todayBounds } = await import("../src/lib/today");
const { eq: dEq, inArray } = await import("drizzle-orm");

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-sched-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-sched-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

try {
  console.log("\n# Service: overdue auto-roll");
  const past = "2026-06-10"; // safely in the past
  const future = "2099-01-01";
  const a = await createItem(owner.id, { type: "task", title: "past non-recurring", scheduledDate: ymdToUtc(past) });
  const b = await createItem(owner.id, {
    type: "task",
    title: "past recurring",
    scheduledDate: ymdToUtc(past),
    properties: { recurrence: makeRecurrence({ freq: "daily", dtstart: past }) },
  });
  const c = await createItem(owner.id, { type: "task", title: "future", scheduledDate: ymdToUtc(future) });
  const d = await createItem(owner.id, { type: "task", title: "past done", status: "done", scheduledDate: ymdToUtc(past) });
  // Overdue by DEADLINE only (no scheduled date) — should also roll, gaining a
  // scheduled date of today (the common "due is in the past" case).
  const e = await createItem(owner.id, { type: "task", title: "past due, no scheduled", dueDate: ymdToUtc(past) });

  const countBefore = await countOverdueScheduled(owner.id);
  check("count: the two open non-recurring overdue tasks (scheduled + due-only)", countBefore === 2, `count=${countBefore}`);

  const { rolled } = await rollOverdueScheduled(owner.id);
  check("roll: exactly two tasks moved", rolled === 2, `rolled=${rolled}`);

  const { dueToday } = todayBounds();
  const reread = async (id: string) =>
    (await db.select({ s: items.scheduledDate, due: items.dueDate }).from(items).where(dEq(items.id, id)))[0];

  check("roll: non-recurring past task → today", (await reread(a.id)).s?.getTime() === dueToday.getTime());
  check("roll: recurring task left alone", (await reread(b.id)).s?.getTime() === ymdToUtc(past).getTime());
  check("roll: future task left alone", (await reread(c.id)).s?.getTime() === ymdToUtc(future).getTime());
  check("roll: done task left alone", (await reread(d.id)).s?.getTime() === ymdToUtc(past).getTime());
  const eAfter = await reread(e.id);
  check("roll: due-only overdue gets scheduled=today", eAfter.s?.getTime() === dueToday.getTime());
  check("roll: due-only overdue keeps its (missed) deadline", eAfter.due?.getTime() === ymdToUtc(past).getTime());

  check("count: zero overdue after the roll", (await countOverdueScheduled(owner.id)) === 0);

  console.log("\n# Service: owner scoping");
  const otherRoll = await rollOverdueScheduled(other.id);
  check("scoping: another owner's roll moves nothing of mine", otherRoll.rolled === 0);
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o));
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
