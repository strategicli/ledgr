// The Year Map's pure half (ADR-287): its saved settings and the month-row
// geometry. No React, no DB, so scripts/verify-year-map.mts can test it in node.
//
// Settings live on the view at display.modes.year. Parse is tolerant like
// parseDisplay: a bad or missing key falls back to YEAR_DEFAULTS, so a stale
// or hand-edited row can never wedge the render.
import { assignLanes } from "@/lib/planner-overlap";

export const YEAR_MODE = "year";

// Fills for color-by values, in assignment order. Pastels, so the dark bar ink
// reads on them in both themes.
export const PALETTE = [
  "#fbbf24", "#86efac", "#93c5fd", "#fca5a5", "#c4b5fd",
  "#f9a8d4", "#fdba74", "#a5f3fc", "#d9f99d", "#d4d4d8",
];
// Style-by values map onto these in order (the first value stays plain solid).
export const BAR_STYLES = ["solid", "outline", "striped", "bold", "dashed", "caps", "dot"] as const;
export type BarStyle = (typeof BAR_STYLES)[number];

export const PAPERS = {
  letter: "Letter",
  legal: "Legal",
  tabloid: "Tabloid",
  a4: "A4",
  a3: "A3",
} as const;
export type Paper = keyof typeof PAPERS;

export type YearSettings = {
  layout: "scroll" | "fit";
  align: "weekday" | "day1";
  textPx: number; // 5–20
  dayPx: number; // 12–120, Scroll layout only
  window: "year" | "fiscal" | "rolling";
  fiscalStart: number; // 1–12, the month a fiscal year opens
  months: number; // 1–24, the rolling window's length
  colorBy: string; // "tag" | "type" | "status" | "prop:<key>"
  styleBy: string | null;
  colors: Record<string, Record<string, string>>; // field → value → #hex
  off: Record<string, string[]>; // field → values toggled off in the legend
  fadePast: boolean;
  weekends: boolean;
  dots: boolean;
  paper: Paper;
  showCalendar: boolean; // Outlook all-day and multi-day events (needs calendar sync)
};

export const YEAR_DEFAULTS: YearSettings = {
  layout: "scroll",
  align: "weekday",
  textPx: 11,
  dayPx: 40,
  window: "year",
  fiscalStart: 7,
  months: 3,
  colorBy: "tag",
  styleBy: null,
  colors: {},
  off: {},
  fadePast: true,
  weekends: true,
  dots: true,
  paper: "letter",
  showCalendar: false,
};

const FIELD = /^(tag|type|status|prop:[A-Za-z0-9_-]{1,64})$/;
const HEX = /^#[0-9a-f]{6}$/i;

function num(v: unknown, lo: number, hi: number, d: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, n)) : d;
}
function pick<T extends string>(v: unknown, opts: readonly T[], d: T): T {
  return opts.includes(v as T) ? (v as T) : d;
}

export function parseYearSettings(raw: unknown): YearSettings {
  const r = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const D = YEAR_DEFAULTS;
  const colors: YearSettings["colors"] = {};
  if (typeof r.colors === "object" && r.colors !== null) {
    for (const [f, m] of Object.entries(r.colors)) {
      if (!FIELD.test(f) || typeof m !== "object" || m === null) continue;
      const vals = Object.entries(m).filter(([k, c]) => k.length <= 200 && typeof c === "string" && HEX.test(c));
      if (vals.length) colors[f] = Object.fromEntries(vals) as Record<string, string>;
    }
  }
  const off: YearSettings["off"] = {};
  if (typeof r.off === "object" && r.off !== null) {
    for (const [f, list] of Object.entries(r.off)) {
      if (!FIELD.test(f) || !Array.isArray(list)) continue;
      const vals = list.filter((v): v is string => typeof v === "string" && v.length <= 200);
      if (vals.length) off[f] = vals;
    }
  }
  return {
    layout: pick(r.layout, ["scroll", "fit"] as const, D.layout),
    align: pick(r.align, ["weekday", "day1"] as const, D.align),
    textPx: num(r.textPx, 5, 20, D.textPx),
    dayPx: num(r.dayPx, 12, 120, D.dayPx),
    window: pick(r.window, ["year", "fiscal", "rolling"] as const, D.window),
    fiscalStart: num(r.fiscalStart, 1, 12, D.fiscalStart),
    months: num(r.months, 1, 24, D.months),
    colorBy: typeof r.colorBy === "string" && FIELD.test(r.colorBy) ? r.colorBy : D.colorBy,
    styleBy: typeof r.styleBy === "string" && FIELD.test(r.styleBy) ? r.styleBy : null,
    colors,
    off,
    fadePast: typeof r.fadePast === "boolean" ? r.fadePast : D.fadePast,
    weekends: typeof r.weekends === "boolean" ? r.weekends : D.weekends,
    dots: typeof r.dots === "boolean" ? r.dots : D.dots,
    paper: pick(r.paper, Object.keys(PAPERS) as Paper[], D.paper),
    showCalendar: typeof r.showCalendar === "boolean" ? r.showCalendar : D.showCalendar,
  };
}

// --- the window ------------------------------------------------------------

export type Ym = { y: number; m: number }; // m = 1..12

export function addMonths(a: Ym, n: number): Ym {
  const i = a.y * 12 + (a.m - 1) + n;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}
export const ymKey = (a: Ym) => `${a.y}-${String(a.m).padStart(2, "0")}`;

// The month the window opens on, for an anchor month (the ?month= param, else
// today): January, the most recent fiscal start, or the anchor itself.
export function windowStart(s: YearSettings, anchor: Ym): Ym {
  if (s.window === "year") return { y: anchor.y, m: 1 };
  if (s.window === "fiscal") return { y: anchor.m >= s.fiscalStart ? anchor.y : anchor.y - 1, m: s.fiscalStart };
  return anchor;
}
export function windowLength(s: YearSettings): number {
  return s.window === "rolling" ? s.months : 12;
}

// --- one month row ---------------------------------------------------------

export const daysIn = (a: Ym) => new Date(Date.UTC(a.y, a.m, 0)).getUTCDate();
// Monday = 0 … Sunday = 6.
export const weekdayOf = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

// Columns: 37 weekday slots (a month starting Sunday still fits 31 days), so
// every Saturday/Sunday lands in the same column down the page; or 31 for
// "Day 1" alignment. `offset` = blank slots before the 1st.
export function monthColumns(s: YearSettings, a: Ym): { cols: number; offset: number } {
  return s.align === "weekday" ? { cols: 37, offset: weekdayOf(a.y, a.m, 1) } : { cols: 31, offset: 0 };
}

export type Span = { id: string; start: string; end: string }; // YYYY-MM-DD, end inclusive
export type Seg = { id: string; from: number; to: number; lane: number; single: boolean };

// The pieces of each span that fall in this month (days `from`..`to`), packed
// into lanes so no two overlap. Long spans first, so a bar keeps a low lane.
export function monthSegments(spans: Span[], a: Ym): { segs: Seg[]; lanes: number } {
  const first = `${ymKey(a)}-01`;
  const nd = daysIn(a);
  const last = `${ymKey(a)}-${String(nd).padStart(2, "0")}`;
  const raw = spans
    .filter((s) => s.start <= last && s.end >= first)
    .map((s) => ({
      id: s.id,
      from: s.start < first ? 1 : Number(s.start.slice(8, 10)),
      to: s.end > last ? nd : Number(s.end.slice(8, 10)),
      single: s.start === s.end,
    }))
    .sort((x, y) => x.from - y.from || y.to - y.from - (x.to - x.from) || x.id.localeCompare(y.id));
  const { laneOf, lanes } = assignLanes(raw.map((s) => ({ id: s.id, startMin: s.from, endMin: s.to + 1 })));
  return { segs: raw.map((s) => ({ ...s, lane: laneOf.get(s.id) ?? 0 })), lanes };
}

// --- color and style -------------------------------------------------------

// A value's fill: the owner's pick for this field, else the palette by the
// value's position among the field's values.
export function colorFor(s: YearSettings, field: string, value: string, values: string[]): string {
  return s.colors[field]?.[value] ?? PALETTE[Math.max(0, values.indexOf(value)) % PALETTE.length];
}
export function styleFor(value: string, values: string[]): BarStyle {
  return BAR_STYLES[Math.max(0, values.indexOf(value)) % BAR_STYLES.length];
}

// --- Outlook events (slice 3) ------------------------------------------------

export type OutlookSpan = { id: string; title: string; start: string; end: string; location: string | null; allDay: boolean };

// The cached Outlook events worth a bar on a month row: all-day events, and
// timed events that run past midnight. A timed 2-hour meeting is a dot of
// noise on a year map, so it is dropped. All-day events carry whole days
// (1440 minutes each); a timed end of exactly midnight stays on its own day.
export function outlookSpans(
  events: { id: string; title: string; ymd: string; start: string | null; durationMinutes: number; location: string | null }[]
): OutlookSpan[] {
  const out: OutlookSpan[] = [];
  for (const e of events) {
    const allDay = e.start === null;
    const startMin = allDay ? 0 : Number(e.start!.slice(0, 2)) * 60 + Number(e.start!.slice(3, 5));
    const days = allDay
      ? Math.max(1, Math.round(e.durationMinutes / 1440)) - 1
      : Math.floor((startMin + Math.max(0, e.durationMinutes) - 1) / 1440);
    if (!allDay && days < 1) continue;
    out.push({ id: e.id, title: e.title, start: e.ymd, end: addDays(e.ymd, days), location: e.location, allDay });
  }
  return out;
}

// --- dragging (slice 2) ----------------------------------------------------

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}
export const fmtSpan = (s: DaySpan) => (s.start === s.end ? fmtDay(s.start) : `${fmtDay(s.start)} → ${fmtDay(s.end)}`);

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// Whole days from a to b (negative when b is earlier).
export function dayDiff(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export type DragKind = "move" | "start" | "end";
export type DaySpan = { start: string; end: string };

// Where a drag puts the span: a move shifts both ends by the days the pointer
// travelled from where it grabbed; an edge drag sets that end to the day under
// the pointer, never past the other end.
export function dragSpan(kind: DragKind, orig: DaySpan, grab: string, at: string): DaySpan {
  if (kind === "move") {
    const d = dayDiff(grab, at);
    return { start: addDays(orig.start, d), end: addDays(orig.end, d) };
  }
  if (kind === "start") return { start: at <= orig.end ? at : orig.end, end: orig.end };
  return { start: orig.start, end: at >= orig.start ? at : orig.start };
}
