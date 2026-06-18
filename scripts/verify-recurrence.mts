// T1 verification (ADR-076): the native recurrence engine. Two halves:
//   1. The PURE engine (recurrence.ts) — no DB: RRULE parse/format round-trip,
//      calendar-date math (DST-safe, month-end clamp, leap year), occurrence
//      enumeration (daily/weekly/byday/monthly/yearly + interval/count/until),
//      next-uncompleted, the complete/skip transitions, fixed vs completion
//      anchor, end conditions, descriptions.
//   2. The SERVICE (recurrence-service.ts + clone.ts + updateItem) against live
//      Neon under throwaway owners: completing a virtual series advances scheduled
//      and stays open; series end marks done; maintain-due-offset; the clone
//      primitive (fresh unchecked subtasks, carried relations); materialized
//      create-next-after-completion (one live occurrence, no stacking); owner
//      scoping. Cleans up in finally.
// Run: npx tsx scripts/verify-recurrence.mts   (safe to delete once T1 closes)
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const {
  isYmd,
  addDaysYmd,
  addMonthsYmd,
  addYearsYmd,
  weekdayOf,
  parseRRule,
  formatRRule,
  parseRecurrence,
  makeRecurrence,
  enumerateOccurrences,
  nextOccurrenceOnOrAfter,
  nextUncompletedOnOrAfter,
  completeOccurrence,
  skipOccurrence,
  describeRule,
  dateToYmdUtc,
} = await import("../src/lib/recurrence");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, g === w ? "" : `got ${g}, want ${w}`);
}

// ---------------------------------------------------------------------------
console.log("\n# Pure: calendar-date math");
eq("addDays simple", addDaysYmd("2026-06-17", 5), "2026-06-22");
eq("addDays across month", addDaysYmd("2026-06-29", 5), "2026-07-04");
// US spring-forward is 2026-03-08; consecutive calendar days must not skip/dup.
eq("addDays across DST (Mar 7→8)", addDaysYmd("2026-03-07", 1), "2026-03-08");
eq("addDays across DST (Mar 8→9)", addDaysYmd("2026-03-08", 1), "2026-03-09");
eq("addMonths clamps Jan31→Feb", addMonthsYmd("2026-01-31", 1), "2026-02-28");
eq("addMonths Jan31+2→Mar31", addMonthsYmd("2026-01-31", 2), "2026-03-31");
eq("addMonths wraps year", addMonthsYmd("2026-11-15", 3), "2027-02-15");
eq("addYears leap→non-leap clamp", addYearsYmd("2024-02-29", 1), "2025-02-28");
eq("weekdayOf Wed", weekdayOf("2026-06-17"), "WE");
eq("weekdayOf Sun", weekdayOf("2026-06-21"), "SU");
check("isYmd rejects bad day", !isYmd("2026-02-30"));
check("isYmd accepts leap day", isYmd("2024-02-29"));

console.log("\n# Pure: RRULE parse / format");
eq("parse daily", parseRRule("FREQ=DAILY"), { freq: "daily", interval: 1 });
eq(
  "parse weekly+byday+interval",
  parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR"),
  { freq: "weekly", interval: 2, byDay: ["MO", "WE", "FR"] }
);
eq("parse count", parseRRule("FREQ=DAILY;COUNT=3"), { freq: "daily", interval: 1, count: 3 });
eq("parse until (ICS form)", parseRRule("FREQ=DAILY;UNTIL=20260620T000000Z")?.until, "2026-06-20");
check("parse rejects junk", parseRRule("nonsense") === null);
eq(
  "format round-trips",
  formatRRule(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")!),
  "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"
);
eq("format drops interval=1", formatRRule({ freq: "daily", interval: 1 }), "FREQ=DAILY");

console.log("\n# Pure: occurrence enumeration");
const daily = { rrule: "FREQ=DAILY", dtstart: "2026-06-17" };
eq("daily window", enumerateOccurrences(daily, { from: "2026-06-17", to: "2026-06-20" }), [
  "2026-06-17",
  "2026-06-18",
  "2026-06-19",
  "2026-06-20",
]);
const every2d = { rrule: "FREQ=DAILY;INTERVAL=2", dtstart: "2026-06-17" };
eq("every-2-days", enumerateOccurrences(every2d, { from: "2026-06-17", to: "2026-06-23" }), [
  "2026-06-17",
  "2026-06-19",
  "2026-06-21",
  "2026-06-23",
]);
// 2026-06-17 is Wed. Weekly on MO,WE,FR from that Wed.
const mwf = { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", dtstart: "2026-06-17" };
eq("weekly MWF first week starts at dtstart", enumerateOccurrences(mwf, { from: "2026-06-17", to: "2026-06-24" }), [
  "2026-06-17", // Wed
  "2026-06-19", // Fri
  "2026-06-22", // Mon
  "2026-06-24", // Wed
]);
const biweeklyMon = { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", dtstart: "2026-06-15" };
eq("biweekly Monday skips the off week", enumerateOccurrences(biweeklyMon, { from: "2026-06-15", to: "2026-07-14" }), [
  "2026-06-15",
  "2026-06-29",
  "2026-07-13",
]);
const monthly31 = { rrule: "FREQ=MONTHLY", dtstart: "2026-01-31" };
eq("monthly clamps to month end", enumerateOccurrences(monthly31, { to: "2026-04-30", max: 4 }), [
  "2026-01-31",
  "2026-02-28",
  "2026-03-31",
  "2026-04-30",
]);
const counted = { rrule: "FREQ=DAILY;COUNT=3", dtstart: "2026-06-17" };
eq("count caps the series", enumerateOccurrences(counted, {}), ["2026-06-17", "2026-06-18", "2026-06-19"]);
const untilRule = { rrule: "FREQ=DAILY;UNTIL=20260619", dtstart: "2026-06-17" };
eq("until ends the series (inclusive)", enumerateOccurrences(untilRule, {}), [
  "2026-06-17",
  "2026-06-18",
  "2026-06-19",
]);

console.log("\n# Pure: next-occurrence + log awareness");
eq("nextOnOrAfter hits dtstart", nextOccurrenceOnOrAfter(daily, "2026-06-17"), "2026-06-17");
eq("nextOnOrAfter future", nextOccurrenceOnOrAfter(every2d, "2026-06-18"), "2026-06-19");
const logged = makeRecurrence({ freq: "daily", dtstart: "2026-06-17" });
logged.completeInstances = ["2026-06-17", "2026-06-18"];
logged.skippedInstances = ["2026-06-19"];
eq("nextUncompleted skips logged dates", nextUncompletedOnOrAfter(logged, "2026-06-17"), "2026-06-20");

console.log("\n# Pure: complete / skip transitions (fixed anchor)");
{
  const rule = makeRecurrence({ freq: "weekly", byDay: ["MO"], dtstart: "2026-06-15" });
  const r = completeOccurrence(rule, "2026-06-15");
  eq("fixed complete stamps the date", r.rule.completeInstances, ["2026-06-15"]);
  eq("fixed complete advances to next Monday", r.next, "2026-06-22");
  check("fixed complete not ended", r.ended === false);
}
{
  // Missing a week does NOT stack: next is just the next rule date after the
  // completed one (missed dates are simply absent from the log).
  const rule = makeRecurrence({ freq: "daily", dtstart: "2026-06-10" });
  const r = completeOccurrence(rule, "2026-06-17");
  eq("no stacking — next is the day after the completed one", r.next, "2026-06-18");
}
{
  const rule = makeRecurrence({ freq: "daily", dtstart: "2026-06-17", count: 2 });
  const r1 = completeOccurrence(rule, "2026-06-17");
  eq("counted: first completion advances", r1.next, "2026-06-18");
  const r2 = completeOccurrence(r1.rule, "2026-06-18");
  check("counted: last completion ends the series", r2.ended === true && r2.next === null);
}
{
  const rule = makeRecurrence({ freq: "weekly", byDay: ["MO"], dtstart: "2026-06-15" });
  const r = skipOccurrence(rule, "2026-06-15");
  eq("skip records the date", r.rule.skippedInstances, ["2026-06-15"]);
  eq("skip advances past it", r.next, "2026-06-22");
}

console.log("\n# Pure: completion-anchored recurrence");
{
  // "Every 3 days AFTER I complete it" — next is computed from completedOn, not
  // a fixed calendar.
  const rule = makeRecurrence({ freq: "daily", interval: 3, dtstart: "2026-06-17", anchorMode: "completion" });
  const r = completeOccurrence(rule, "2026-06-17", "2026-06-20"); // finished 3 days late
  eq("completion anchor: next = completedOn + interval", r.next, "2026-06-23");
}
{
  const rule = makeRecurrence({ freq: "weekly", interval: 2, dtstart: "2026-06-17", anchorMode: "completion" });
  const r = completeOccurrence(rule, "2026-06-17", "2026-06-18");
  eq("completion anchor weekly: +2 weeks from completion", r.next, "2026-07-02");
}

console.log("\n# Pure: descriptions");
eq("describe daily", describeRule(makeRecurrence({ freq: "daily", dtstart: "2026-06-17" })), "Daily");
eq("describe every 2 weeks MWF", describeRule(makeRecurrence({ freq: "weekly", interval: 2, byDay: ["MO", "WE", "FR"], dtstart: "2026-06-17" })), "Every 2 weeks on Mon, Wed, Fri");
eq("describe completion-anchored", describeRule(makeRecurrence({ freq: "daily", interval: 3, dtstart: "2026-06-17", anchorMode: "completion" })), "Every 3 days after completion");

console.log("\n# Pure: tolerant parse of the stored shape");
check("parseRecurrence rejects no-rule", parseRecurrence({ dtstart: "2026-06-17" }) === null);
check("parseRecurrence rejects bad dtstart", parseRecurrence({ rrule: "FREQ=DAILY", dtstart: "nope" }) === null);
{
  const parsed = parseRecurrence({
    rrule: "FREQ=DAILY",
    dtstart: "2026-06-17",
    completeInstances: ["2026-06-18", "2026-06-17", "2026-06-17", "bad"],
    occurrenceMode: "materialized",
    anchorMode: "completion",
  });
  eq("parseRecurrence dedupes+sorts+drops bad dates", parsed?.completeInstances, ["2026-06-17", "2026-06-18"]);
  eq("parseRecurrence keeps occurrenceMode", parsed?.occurrenceMode, "materialized");
  eq("parseRecurrence keeps anchorMode", parsed?.anchorMode, "completion");
}

// ---------------------------------------------------------------------------
// SERVICE half (live Neon)
const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const { createItem, updateItem, getItem } = await import("../src/lib/items");
const { cloneItemSubtree } = await import("../src/lib/clone");
const { ensureFirstOccurrence, OCCURRENCE_ROLE } = await import("../src/lib/recurrence-service");
const { relateItems } = await import("../src/lib/relations");
const { and, eq: dEq, inArray } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-recurrence-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-recurrence-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

try {
  console.log("\n# Service: virtual series completion advances, stays open");
  {
    const rule = makeRecurrence({ freq: "daily", dtstart: "2026-06-17" });
    const task = await createItem(owner.id, {
      type: "task",
      title: "Daily standup",
      scheduledDate: ymdToUtc("2026-06-17"),
      properties: { recurrence: rule },
    });
    const advanced = await updateItem(owner.id, task.id, { status: "done" });
    check("virtual: stays open after completion", advanced.status === "open");
    eq("virtual: scheduled advanced one day", dateToYmdUtc(advanced.scheduledDate!), "2026-06-18");
    const props = advanced.properties as Record<string, unknown>;
    const rec = props.recurrence as { completeInstances: string[] };
    eq("virtual: completion logged", rec.completeInstances, ["2026-06-17"]);
    // Complete again
    const advanced2 = await updateItem(owner.id, task.id, { status: "done" });
    eq("virtual: second completion advances again", dateToYmdUtc(advanced2.scheduledDate!), "2026-06-19");
    const rec2 = (advanced2.properties as Record<string, unknown>).recurrence as { completeInstances: string[] };
    eq("virtual: both completions logged", rec2.completeInstances, ["2026-06-17", "2026-06-18"]);
  }

  console.log("\n# Service: counted series ends → done, scheduled cleared");
  {
    const rule = makeRecurrence({ freq: "daily", dtstart: "2026-06-17", count: 1 });
    const task = await createItem(owner.id, {
      type: "task",
      title: "One-shot",
      scheduledDate: ymdToUtc("2026-06-17"),
      properties: { recurrence: rule },
    });
    const done = await updateItem(owner.id, task.id, { status: "done" });
    check("counted: series marked done at end", done.status === "done");
    check("counted: scheduled cleared at end", done.scheduledDate === null);
  }

  console.log("\n# Service: maintain-due-offset shifts due with scheduled");
  {
    const rule = makeRecurrence({ freq: "weekly", dtstart: "2026-06-15", maintainDueOffset: true });
    const task = await createItem(owner.id, {
      type: "task",
      title: "Weekly report",
      scheduledDate: ymdToUtc("2026-06-15"), // Mon
      dueDate: ymdToUtc("2026-06-17"), // Wed — a 2-day gap
      properties: { recurrence: rule },
    });
    const advanced = await updateItem(owner.id, task.id, { status: "done" });
    eq("offset: scheduled +1 week", dateToYmdUtc(advanced.scheduledDate!), "2026-06-22");
    eq("offset: due shifts the same 7 days, gap preserved", dateToYmdUtc(advanced.dueDate!), "2026-06-24");
  }

  console.log("\n# Service: cloneItemSubtree resets subtasks, carries relations");
  {
    const person = await createItem(owner.id, { type: "person", title: "Roger" });
    const proto = await createItem(owner.id, {
      type: "task",
      title: "1:1 agenda",
      body: { format: "markdown", text: "## Agenda\n- check-in" },
    });
    await relateItems(owner.id, proto.id, person.id, "related");
    const sub1 = await createItem(owner.id, { type: "task", title: "Review goals", parentId: proto.id });
    await createItem(owner.id, { type: "task", title: "Follow-ups", parentId: proto.id });
    // Mutate the prototype's subtask (as if a past occurrence had checked it).
    await updateItem(owner.id, sub1.id, { status: "done" });

    const { rootId, count } = await cloneItemSubtree(owner.id, proto.id, {}, { status: "open" });
    check("clone: counted root + 2 subtasks", count === 3, `count=${count}`);
    const clone = await getItem(owner.id, rootId);
    eq("clone: body copied from prototype", (clone.body as { text: string }).text, "## Agenda\n- check-in");
    const cloneKids = await db
      .select({ status: items.status, title: items.title })
      .from(items)
      .where(and(dEq(items.parentId, rootId), dEq(items.ownerId, owner.id)));
    check("clone: all subtasks reset to open", cloneKids.every((k) => k.status === "open"), JSON.stringify(cloneKids));
    const carried = await db
      .select({ targetId: relations.targetId })
      .from(relations)
      .where(dEq(relations.sourceId, rootId));
    check("clone: prototype relation carried", carried.some((r) => r.targetId === person.id));
  }

  console.log("\n# Service: materialized create-next-after-completion (no stacking)");
  {
    const rule = makeRecurrence({ freq: "weekly", byDay: ["MO"], dtstart: "2026-06-15", occurrenceMode: "materialized" });
    const series = await createItem(owner.id, {
      type: "task",
      title: "Weekly 1:1",
      scheduledDate: ymdToUtc("2026-06-15"),
      properties: { recurrence: rule },
    });
    await createItem(owner.id, { type: "task", title: "Prep notes", parentId: series.id });

    const occ1Id = await ensureFirstOccurrence(owner.id, series.id);
    check("materialized: first occurrence created", typeof occ1Id === "string");
    check("materialized: ensureFirstOccurrence is idempotent", (await ensureFirstOccurrence(owner.id, series.id)) === null);

    // The live occurrence is linked to the series and carries a fresh subtask.
    const liveOcc = await db
      .select({ id: items.id, scheduled: items.scheduledDate, status: items.status })
      .from(relations)
      .innerJoin(items, dEq(items.id, relations.sourceId))
      .where(and(dEq(relations.targetId, series.id), dEq(relations.role, OCCURRENCE_ROLE)));
    check("materialized: exactly one live occurrence", liveOcc.length === 1, `count=${liveOcc.length}`);
    eq("materialized: occurrence scheduled on dtstart", dateToYmdUtc(liveOcc[0].scheduled!), "2026-06-15");
    const occKids = await db
      .select({ id: items.id })
      .from(items)
      .where(and(dEq(items.parentId, occ1Id!), dEq(items.ownerId, owner.id)));
    check("materialized: occurrence got a fresh subtask clone", occKids.length === 1, `kids=${occKids.length}`);

    // Complete the occurrence → it's done history; series advances; next cloned.
    await updateItem(owner.id, occ1Id!, { status: "done" });
    const occ1After = await getItem(owner.id, occ1Id!);
    check("materialized: completed occurrence stays done (history)", occ1After.status === "done");
    const occsNow = await db
      .select({ id: items.id, scheduled: items.scheduledDate, status: items.status })
      .from(relations)
      .innerJoin(items, dEq(items.id, relations.sourceId))
      .where(and(dEq(relations.targetId, series.id), dEq(relations.role, OCCURRENCE_ROLE)));
    const live = occsNow.filter((o) => o.status !== "done");
    check("materialized: exactly one live occurrence after completion (no stacking)", live.length === 1, `live=${live.length}`);
    eq("materialized: next occurrence on the following Monday", dateToYmdUtc(live[0].scheduled!), "2026-06-22");
    const seriesAfter = await getItem(owner.id, series.id);
    const sRec = (seriesAfter.properties as Record<string, unknown>).recurrence as { completeInstances: string[] };
    eq("materialized: series log advanced", sRec.completeInstances, ["2026-06-15"]);
  }

  console.log("\n# Service: owner scoping");
  {
    const rule = makeRecurrence({ freq: "daily", dtstart: "2026-06-17" });
    const task = await createItem(owner.id, { type: "task", title: "Mine", properties: { recurrence: rule } });
    let blocked = false;
    try {
      await updateItem(other.id, task.id, { status: "done" });
    } catch {
      blocked = true;
    }
    check("scoping: another owner cannot complete my recurring task", blocked);
  }
} finally {
  // Clean up: detach parent_id (self-FK has no cascade), then delete every item
  // under both throwaway owners (relations/revisions cascade), then the users.
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o));
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
