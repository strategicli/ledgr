// Year Map (ADR-287) verification: the module's pure half (settings parse, window,
// month geometry, lanes, color/style), the view-display parse that keeps a module
// mode and its settings, and layoutOverlaps staying as it was beside assignLanes.
// Pure: no DB connection is opened. Run: npx tsx scripts/verify-year-map.mts
import assert from "node:assert/strict";

const Y = await import("../src/modules/year-map/lib");
const { layoutOverlaps, assignLanes } = await import("../src/lib/planner-overlap");
const { parseDisplay } = await import("../src/lib/views");

let n = 0;
function t(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`PASS  ${name}`);
}

t("outlookSpans: all-day and midnight-crossing events only", () => {
  const ev = (id: string, ymd: string, start: string | null, durationMinutes: number) => ({ id, title: id, ymd, start, durationMinutes, location: null });
  const r = Y.outlookSpans([
    ev("a", "2026-10-05", null, 1440),
    ev("b", "2026-10-06", null, 4320),
    ev("c", "2026-10-07", "09:00", 120),
    ev("d", "2026-10-08", "09:00", 4320),
    ev("e", "2026-10-09", "22:00", 180),
  ]);
  assert.deepEqual(r.map((x) => [x.id, x.start, x.end, x.allDay]), [
    ["a", "2026-10-05", "2026-10-05", true],
    ["b", "2026-10-06", "2026-10-08", true],
    ["d", "2026-10-08", "2026-10-11", false],
    ["e", "2026-10-09", "2026-10-10", false],
  ]);
});

t("parseYearSettings: showCalendar defaults off, keeps a boolean", () => {
  assert.equal(Y.YEAR_DEFAULTS.showCalendar, false);
  assert.equal(Y.parseYearSettings({ showCalendar: true }).showCalendar, true);
  assert.equal(Y.parseYearSettings({ showCalendar: "yes" }).showCalendar, false);
});

t("parseYearSettings: garbage gives defaults", () => {
  for (const g of [null, undefined, 5, "x", [], [1, 2]]) assert.deepEqual(Y.parseYearSettings(g), Y.YEAR_DEFAULTS);
  assert.deepEqual(Y.parseYearSettings({}), Y.YEAR_DEFAULTS);
});

t("parseYearSettings: clamps numbers, bad values fall back", () => {
  const hi = Y.parseYearSettings({ textPx: 99, dayPx: 999, months: 99, fiscalStart: 13 });
  assert.equal(hi.textPx, 20);
  assert.equal(hi.dayPx, 120);
  assert.equal(hi.months, 24);
  assert.equal(hi.fiscalStart, 12);
  const lo = Y.parseYearSettings({ textPx: 1, dayPx: 1, months: 0, fiscalStart: 0 });
  assert.equal(lo.textPx, 5);
  assert.equal(lo.dayPx, 12);
  assert.equal(lo.months, 1);
  assert.equal(lo.fiscalStart, 1);
  const bad = Y.parseYearSettings({ textPx: "abc", dayPx: null, months: "", layout: "wide", window: "x", paper: "folio" });
  assert.equal(bad.textPx, Y.YEAR_DEFAULTS.textPx);
  assert.equal(bad.dayPx, Y.YEAR_DEFAULTS.dayPx);
  assert.equal(bad.months, Y.YEAR_DEFAULTS.months);
  assert.equal(bad.layout, "scroll");
  assert.equal(bad.window, "year");
  assert.equal(bad.paper, "letter");
  assert.equal(Y.parseYearSettings({ paper: "a3", layout: "fit", align: "day1" }).paper, "a3");
});

t("parseYearSettings: colors and off keep good, drop bad; colorBy falls back to tag", () => {
  const s = Y.parseYearSettings({
    colors: { tag: { Preaching: "#AABBCC", Bad: "red", Short: "#abc" }, "nope!": { a: "#aabbcc" }, type: "x" },
    off: { tag: ["Finance", 3], status: [], "bad key": ["x"] },
    colorBy: "weird",
    styleBy: "prop:Stage_1",
  });
  assert.deepEqual(s.colors, { tag: { Preaching: "#AABBCC" } });
  assert.deepEqual(s.off, { tag: ["Finance"] });
  assert.equal(s.colorBy, "tag");
  assert.equal(s.styleBy, "prop:Stage_1");
  assert.equal(Y.parseYearSettings({ colorBy: "status", styleBy: "junk" }).styleBy, null);
  assert.equal(Y.parseYearSettings({ colorBy: "status" }).colorBy, "status");
});

t("windowStart / windowLength / addMonths", () => {
  const D = Y.YEAR_DEFAULTS;
  assert.deepEqual(Y.windowStart(D, { y: 2026, m: 10 }), { y: 2026, m: 1 });
  assert.equal(Y.windowLength(D), 12);
  const fy = { ...D, window: "fiscal" as const, fiscalStart: 7 };
  assert.deepEqual(Y.windowStart(fy, { y: 2027, m: 3 }), { y: 2026, m: 7 });
  assert.deepEqual(Y.windowStart(fy, { y: 2026, m: 9 }), { y: 2026, m: 7 });
  assert.deepEqual(Y.windowStart(fy, { y: 2026, m: 7 }), { y: 2026, m: 7 });
  const roll = { ...D, window: "rolling" as const, months: 3 };
  assert.deepEqual(Y.windowStart(roll, { y: 2026, m: 11 }), { y: 2026, m: 11 });
  assert.equal(Y.windowLength(roll), 3);
  assert.deepEqual(Y.addMonths({ y: 2026, m: 11 }, 2), { y: 2027, m: 1 });
  assert.deepEqual(Y.addMonths({ y: 2026, m: 1 }, -1), { y: 2025, m: 12 });
  assert.deepEqual(Y.addMonths({ y: 2026, m: 12 }, 12), { y: 2027, m: 12 });
});

t("monthColumns: weekday offset and Day 1", () => {
  const oct = { y: 2026, m: 10 };
  assert.equal(Y.weekdayOf(2026, 10, 1), 3); // Thursday, Monday = 0
  assert.deepEqual(Y.monthColumns(Y.YEAR_DEFAULTS, oct), { cols: 37, offset: 3 });
  assert.deepEqual(Y.monthColumns({ ...Y.YEAR_DEFAULTS, align: "day1" }, oct), { cols: 31, offset: 0 });
  assert.equal(Y.daysIn({ y: 2028, m: 2 }), 29);
  assert.equal(Y.daysIn({ y: 2026, m: 2 }), 28);
  for (let m = 1; m <= 12; m++) {
    const a = { y: 2026, m };
    const { cols, offset } = Y.monthColumns(Y.YEAR_DEFAULTS, a);
    assert.ok(offset + Y.daysIn(a) <= cols, `month ${m} overflows`);
  }
});

const oct = { y: 2026, m: 10 };
const sample = [
  { id: "habakkuk", start: "2026-09-13", end: "2026-10-25" },
  { id: "budget", start: "2026-09-21", end: "2026-11-13" },
  { id: "sabbath", start: "2026-09-28", end: "2026-10-02" },
  { id: "conf", start: "2026-10-05", end: "2026-10-08" },
  { id: "draft", start: "2026-10-12", end: "2026-10-30" },
  { id: "preach", start: "2026-10-18", end: "2026-10-18" },
  { id: "elder", start: "2026-10-27", end: "2026-10-27" },
  { id: "advent", start: "2026-11-29", end: "2026-12-24" },
  { id: "aug", start: "2026-08-10", end: "2026-08-21" },
];

t("monthSegments: clipping, single flag, other months left out", () => {
  const { segs } = Y.monthSegments(sample, oct);
  const by = new Map(segs.map((s) => [s.id, s]));
  assert.equal(by.size, 7);
  assert.ok(!by.has("advent") && !by.has("aug"));
  assert.deepEqual([by.get("habakkuk")!.from, by.get("habakkuk")!.to], [1, 25]);
  assert.deepEqual([by.get("budget")!.from, by.get("budget")!.to], [1, 31]);
  assert.deepEqual([by.get("sabbath")!.from, by.get("sabbath")!.to], [1, 2]);
  assert.equal(by.get("preach")!.single, true);
  assert.equal(by.get("elder")!.single, true);
  assert.equal(by.get("habakkuk")!.single, false);
  const clipped = Y.monthSegments([{ id: "c", start: "2026-09-30", end: "2026-10-01" }], oct).segs[0];
  assert.equal(clipped.single, false);
});

t("monthSegments: overlapping items never share a lane; adjacent spans may", () => {
  const { segs, lanes } = Y.monthSegments(sample, oct);
  for (const a of segs)
    for (const b of segs)
      if (a.id < b.id && a.from <= b.to && b.from <= a.to) assert.notEqual(a.lane, b.lane, `${a.id}/${b.id}`);
  assert.notEqual(segs.find((s) => s.id === "habakkuk")!.lane, segs.find((s) => s.id === "budget")!.lane);
  assert.equal(lanes, Math.max(...segs.map((s) => s.lane)) + 1);
  const adj = Y.monthSegments(
    [
      { id: "a", start: "2026-10-01", end: "2026-10-05" },
      { id: "b", start: "2026-10-06", end: "2026-10-09" },
      { id: "c", start: "2026-10-05", end: "2026-10-09" },
    ],
    oct,
  );
  const lane = (id: string) => adj.segs.find((s) => s.id === id)!.lane;
  assert.equal(lane("a"), lane("b"));
  assert.notEqual(lane("c"), lane("a"));
  assert.deepEqual(Y.monthSegments([], oct), { segs: [], lanes: 0 });
});

t("colorFor / styleFor", () => {
  const vals = ["Preaching", "Finance", "Family"];
  assert.equal(Y.colorFor(Y.YEAR_DEFAULTS, "tag", "Finance", vals), Y.PALETTE[1]);
  const owned = { ...Y.YEAR_DEFAULTS, colors: { tag: { Finance: "#112233" } } };
  assert.equal(Y.colorFor(owned, "tag", "Finance", vals), "#112233");
  assert.equal(Y.colorFor(owned, "tag", "Family", vals), Y.PALETTE[2]);
  assert.equal(Y.colorFor(owned, "status", "Finance", vals), Y.PALETTE[1]); // owner colors are per field
  assert.equal(Y.colorFor(Y.YEAR_DEFAULTS, "tag", "Unknown", vals), Y.PALETTE[0]);
  assert.equal(Y.styleFor("Preaching", vals), "solid");
  assert.equal(Y.styleFor("Finance", vals), "outline");
  assert.equal(Y.styleFor("Family", vals), "striped");
});

t("parseDisplay keeps a module mode and its settings, drops bad ones", () => {
  const ok = parseDisplay({ mode: "year", modes: { year: { textPx: 12 } } });
  assert.equal(ok?.mode, "year");
  assert.deepEqual(ok?.modes, { year: { textPx: 12 } });
  assert.equal(parseDisplay({ mode: "Bad Mode!" }), null);
  assert.equal(parseDisplay({ mode: "month", modes: { year: "nope", x: [] } })?.modes, undefined);
  assert.equal(parseDisplay({ mode: "timeline" })?.mode, "timeline");
});

t("layoutOverlaps unchanged for two overlapping blocks", () => {
  const out = layoutOverlaps([
    { id: "a", startMin: 0, endMin: 60 },
    { id: "b", startMin: 30, endMin: 90 },
  ]);
  assert.deepEqual(out.get("a"), { left: 0, width: 0.5 });
  assert.deepEqual(out.get("b"), { left: 0.5, width: 0.5 });
  assert.equal(assignLanes([{ id: "a", startMin: 0, endMin: 5 }, { id: "b", startMin: 5, endMin: 9 }]).lanes, 1);
});

t("drag math: day steps, moves, and edge drags that never cross", () => {
  assert.equal(Y.addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(Y.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(Y.dayDiff("2026-09-28", "2026-10-02"), 4);
  assert.equal(Y.dayDiff("2026-10-02", "2026-09-28"), -4);
  const span = { start: "2026-09-21", end: "2026-09-25" };
  // Grab mid-bar on the 23rd, drop on Oct 1: both ends shift 8 days, across month rows.
  assert.deepEqual(Y.dragSpan("move", span, "2026-09-23", "2026-10-01"), { start: "2026-09-29", end: "2026-10-03" });
  assert.deepEqual(Y.dragSpan("end", span, "2026-09-25", "2026-10-09"), { start: "2026-09-21", end: "2026-10-09" });
  assert.deepEqual(Y.dragSpan("end", span, "2026-09-25", "2026-09-01"), { start: "2026-09-21", end: "2026-09-21" });
  assert.deepEqual(Y.dragSpan("start", span, "2026-09-21", "2026-09-30"), { start: "2026-09-25", end: "2026-09-25" });
  assert.deepEqual(Y.dragSpan("start", span, "2026-09-21", "2026-09-14"), { start: "2026-09-14", end: "2026-09-25" });
});

console.log(`\n${n} checks passed.`);
