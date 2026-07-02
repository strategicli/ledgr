// S3 verification (ADR-083): the recurrence completions calendar + occurrence
// carve-out. Two halves:
//   1. PURE (recurrence.ts) — no DB: isOccurrence (incl. COUNT/UNTIL bounds),
//      the direct log edits (toggleCompleteInstance / addSkippedInstance), and
//      instanceState.
//   2. SERVICE (recurrence-service.ts + the occurrence route logic) against live
//      Neon under a throwaway owner: toggling an occurrence edits the log + recomputes
//      the forward-looking scheduled date; carve-out clones a fresh DETACHED one-off,
//      the series skips the date + advances, and completing the carved item never
//      touches the series; the materialized + non-recurring guards; owner scoping.
// Run: npx tsx scripts/verify-recurrence-calendar.mts   (safe to delete once S3 closes)
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const {
  makeRecurrence,
  isOccurrence,
  toggleCompleteInstance,
  addSkippedInstance,
  instanceState,
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
console.log("\n# Pure: isOccurrence");
{
  const weeklyWed = makeRecurrence({ freq: "weekly", byDay: ["WE"], dtstart: "2026-06-03" });
  check("occurrence date is an occurrence", isOccurrence(weeklyWed, "2026-06-17"));
  check("non-occurrence date is not", !isOccurrence(weeklyWed, "2026-06-18"));
  check("malformed date is not an occurrence", !isOccurrence(weeklyWed, "nope"));

  const counted = makeRecurrence({ freq: "daily", dtstart: "2026-06-15", count: 2 });
  check("within COUNT is an occurrence", isOccurrence(counted, "2026-06-16"));
  check("past COUNT is not an occurrence", !isOccurrence(counted, "2026-06-17"));

  const until = makeRecurrence({ freq: "daily", dtstart: "2026-06-15", until: "2026-06-16" });
  check("on UNTIL is an occurrence", isOccurrence(until, "2026-06-16"));
  check("past UNTIL is not an occurrence", !isOccurrence(until, "2026-06-17"));
}

console.log("\n# Pure: toggleCompleteInstance");
{
  const base = makeRecurrence({ freq: "daily", dtstart: "2026-06-15" });
  const a = toggleCompleteInstance(base, "2026-06-17");
  eq("toggle on adds the date", a.completeInstances, ["2026-06-17"]);
  const b = toggleCompleteInstance(a, "2026-06-17");
  eq("toggle off removes the date", b.completeInstances, []);
  const c = toggleCompleteInstance(toggleCompleteInstance(base, "2026-06-24"), "2026-06-17");
  eq("multiple toggles stay sorted+deduped", c.completeInstances, ["2026-06-17", "2026-06-24"]);
  // Completing a date clears a prior "skipped" stamp on it (done OR skipped, never both).
  const skipped = addSkippedInstance(base, "2026-06-17");
  const recompleted = toggleCompleteInstance(skipped, "2026-06-17");
  eq("completing clears the skipped stamp", recompleted.skippedInstances, []);
  eq("completing moves it to complete", recompleted.completeInstances, ["2026-06-17"]);
}

console.log("\n# Pure: addSkippedInstance + instanceState");
{
  const base = makeRecurrence({ freq: "daily", dtstart: "2026-06-15" });
  const done = toggleCompleteInstance(base, "2026-06-17");
  const moved = addSkippedInstance(done, "2026-06-17");
  eq("skipping a done date moves it out of complete", moved.completeInstances, []);
  eq("skipping records the date", moved.skippedInstances, ["2026-06-17"]);
  eq("state of a complete date", instanceState(toggleCompleteInstance(base, "2026-06-18"), "2026-06-18"), "complete");
  eq("state of a skipped date", instanceState(addSkippedInstance(base, "2026-06-19"), "2026-06-19"), "skipped");
  eq("state of an untouched date", instanceState(base, "2026-06-20"), "none");
}

// ---------------------------------------------------------------------------
// SERVICE half (live Neon)
const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const { getItem } = await import("../src/lib/items");
const {
  createItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { toggleOccurrenceCompletion, carveOccurrence, OCCURRENCE_ROLE } = await import(
  "../src/lib/recurrence-service"
);
const { and, eq: dEq, inArray } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-rec-cal-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-rec-cal-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

// A fixed "now": noon CDT on Wed 2026-06-17 (an occurrence of the weekly-Wed series).
const NOW = new Date("2026-06-17T17:00:00Z");
function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function recOf(item: { properties: unknown }) {
  return (item.properties as Record<string, unknown>).recurrence as {
    completeInstances: string[];
    skippedInstances: string[];
  };
}

try {
  console.log("\n# Service: toggle an occurrence edits the log + recomputes scheduled");
  {
    // Weekly on Wed from Jun 3; today (Jun 17) is the next uncompleted occurrence.
    const rule = makeRecurrence({ freq: "weekly", byDay: ["WE"], dtstart: "2026-06-03" });
    const task = await createItem(owner.id, {
      type: "task",
      title: "Weekly review",
      scheduledDate: ymdToUtc("2026-06-17"),
      properties: { recurrence: rule },
    });

    // Tick a FUTURE occurrence — logged, but scheduled stays on today's (still open).
    const t1 = await toggleOccurrenceCompletion(owner.id, task.id, "2026-06-24", NOW);
    check("toggle future: logged", recOf(t1).completeInstances.includes("2026-06-24"));
    eq("toggle future: scheduled unchanged (today still next)", dateToYmdUtc(t1.scheduledDate!), "2026-06-17");
    check("toggle future: stays open", t1.status === "open");

    // Tick today's occurrence — scheduled advances past it AND past the done future one.
    const t2 = await toggleOccurrenceCompletion(owner.id, task.id, "2026-06-17", NOW);
    eq("toggle today: both logged", recOf(t2).completeInstances, ["2026-06-17", "2026-06-24"]);
    eq("toggle today: scheduled skips to the next uncompleted (Jul 1)", dateToYmdUtc(t2.scheduledDate!), "2026-07-01");

    // Un-tick today's occurrence — scheduled returns to it.
    const t3 = await toggleOccurrenceCompletion(owner.id, task.id, "2026-06-17", NOW);
    check("untoggle: removed from log", !recOf(t3).completeInstances.includes("2026-06-17"));
    eq("untoggle: scheduled returns to it", dateToYmdUtc(t3.scheduledDate!), "2026-06-17");

    // A non-occurrence date is rejected.
    let rejected = false;
    try {
      await toggleOccurrenceCompletion(owner.id, task.id, "2026-06-18", NOW);
    } catch {
      rejected = true;
    }
    check("toggle a non-occurrence date is rejected", rejected);
  }

  console.log("\n# Service: counted series exhausted → done + scheduled cleared");
  {
    const rule = makeRecurrence({ freq: "daily", dtstart: "2026-06-17", count: 1 });
    const task = await createItem(owner.id, {
      type: "task",
      title: "One Wednesday thing",
      scheduledDate: ymdToUtc("2026-06-17"),
      properties: { recurrence: rule },
    });
    const done = await toggleOccurrenceCompletion(owner.id, task.id, "2026-06-17", NOW);
    check("counted: series goes done when nothing remains forward", done.statusCategory === "done");
    check("counted: scheduled cleared", done.scheduledDate === null);
  }

  console.log("\n# Service: carve-out — fresh detached one-off, series skips + advances");
  {
    const rule = makeRecurrence({ freq: "weekly", byDay: ["WE"], dtstart: "2026-06-03" });
    const series = await createItem(owner.id, {
      type: "task",
      title: "Weekly 1:1",
      scheduledDate: ymdToUtc("2026-06-17"),
      properties: { recurrence: rule },
    });
    await createItem(owner.id, { type: "task", title: "Prep agenda", parentId: series.id });

    // Carve the current next occurrence (Jun 17).
    const { itemId, series: advanced } = await carveOccurrence(owner.id, series.id, "2026-06-17", NOW);
    const carved = await getItem(owner.id, itemId);

    eq("carve: new item scheduled on the carved date", dateToYmdUtc(carved.scheduledDate!), "2026-06-17");
    check("carve: new item is a plain task", carved.type === "task");
    check(
      "carve: new item carries NO recurrence (a one-off)",
      (carved.properties as Record<string, unknown> | null)?.recurrence === undefined
    );

    // The carve is DETACHED: no `occurrence` edge linking it to the series.
    const occEdges = await db
      .select({ id: relations.sourceId })
      .from(relations)
      .where(and(dEq(relations.sourceId, itemId), dEq(relations.role, OCCURRENCE_ROLE)));
    check("carve: not linked by the occurrence role (detached)", occEdges.length === 0);

    // The carve got a FRESH subtask (cloned from the prototype, unchecked).
    const carvedKids = await db
      .select({ status: items.status })
      .from(items)
      .where(and(dEq(items.parentId, itemId), dEq(items.ownerId, owner.id)));
    check("carve: fresh subtask cloned", carvedKids.length === 1, `kids=${carvedKids.length}`);

    // The series skipped the date and advanced past it.
    check("carve: series skipped the date", recOf(advanced).skippedInstances.includes("2026-06-17"));
    eq("carve: series scheduled advanced to the next occurrence", dateToYmdUtc(advanced.scheduledDate!), "2026-06-24");
    check("carve: series title untouched", advanced.title === "Weekly 1:1");

    // Editing/completing the carved one-off must NOT touch the series.
    await updateItem(owner.id, itemId, { status: "done" });
    const seriesAfter = await getItem(owner.id, series.id);
    eq("carve: completing the one-off leaves series scheduled put", dateToYmdUtc(seriesAfter.scheduledDate!), "2026-06-24");
    eq("carve: completing the one-off doesn't log on the series", recOf(seriesAfter).completeInstances, []);
  }

  console.log("\n# Service: guards (materialized, non-recurring, owner scoping)");
  {
    const matRule = makeRecurrence({
      freq: "weekly",
      byDay: ["WE"],
      dtstart: "2026-06-03",
      occurrenceMode: "materialized",
    });
    const mat = await createItem(owner.id, {
      type: "task",
      title: "Materialized series",
      scheduledDate: ymdToUtc("2026-06-17"),
      properties: { recurrence: matRule },
    });
    let matBlocked = false;
    try {
      await toggleOccurrenceCompletion(owner.id, mat.id, "2026-06-17", NOW);
    } catch {
      matBlocked = true;
    }
    check("materialized series: calendar toggle rejected", matBlocked);

    let carveMatBlocked = false;
    try {
      await carveOccurrence(owner.id, mat.id, "2026-06-17", NOW);
    } catch {
      carveMatBlocked = true;
    }
    check("materialized series: carve rejected", carveMatBlocked);

    const plain = await createItem(owner.id, { type: "task", title: "Not recurring" });
    let plainBlocked = false;
    try {
      await toggleOccurrenceCompletion(owner.id, plain.id, "2026-06-17", NOW);
    } catch {
      plainBlocked = true;
    }
    check("non-recurring task: calendar toggle rejected", plainBlocked);

    const mine = await createItem(owner.id, {
      type: "task",
      title: "Mine",
      scheduledDate: ymdToUtc("2026-06-17"),
      properties: { recurrence: makeRecurrence({ freq: "weekly", byDay: ["WE"], dtstart: "2026-06-03" }) },
    });
    let scoped = false;
    try {
      await toggleOccurrenceCompletion(other.id, mine.id, "2026-06-17", NOW);
    } catch {
      scoped = true;
    }
    check("scoping: another owner cannot toggle my occurrence", scoped);
  }
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o));
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
