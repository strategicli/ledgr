// Pure geometry for the Timeline mode (ADR-166): mapping a calendar day (+
// optional minutes) to an x offset on one continuous horizontal axis, and back.
// The vertical axis is lanes (planner-overlap.ts), not time — so this file owns
// only the horizontal mapping and the ruler ticks. No DOM, no React; node-
// testable, the sibling of planner-grid.ts (which owns the vertical time-grid).
//
// Zoom = px-per-day. Everything scrolls horizontally; the caller sizes the
// canvas to spanDays * pxPerDay and positions items with dateToX.

import type { TimelineZoom } from "@/lib/views";

// px per calendar day at each zoom. Tuned so a screenful (~1200px) shows roughly
// the zoom's namesake span: hour → a few hours, week → ~a week, year → ~a year.
const PX_PER_DAY: Record<TimelineZoom, number> = {
  hour: 2400, // 100px/hour
  day: 720,
  week: 150, // ~8 days per 1200px
  month: 42, // ~28 days
  quarter: 14, // ~85 days
  year: 3.4, // ~1 year
  halfDecade: 0.7, // ~4.7 years
};

export function pxPerDay(zoom: TimelineZoom): number {
  return PX_PER_DAY[zoom];
}

// Drag/scroll snap granularity in minutes: fine zooms snap to a slot, coarse
// zooms snap to the whole day (null = day-only placement).
export function snapMinutes(zoom: TimelineZoom): number | null {
  if (zoom === "hour") return 15;
  if (zoom === "day") return 30;
  return null;
}

// Whole calendar days between two YYYY-MM-DD keys (b - a). Uses UTC midnights so
// DST never skews the count (ADR-008 days are UTC-midnight anyway).
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / 86_400_000);
}

// x offset (px) of an anchor {ymd, minutes} measured from the origin day's start.
export function dateToX(
  ymd: string,
  minutes: number | null,
  originYmd: string,
  zoom: TimelineZoom,
): number {
  const ppd = PX_PER_DAY[zoom];
  const dayPart = daysBetween(originYmd, ymd) * ppd;
  const intraday = minutes != null ? (minutes / 1440) * ppd : 0;
  return dayPart + intraday;
}

// Inverse of dateToX: an x offset → the {ymd, minutes} it lands on, snapped to
// the zoom's granularity. minutes is null at coarse zooms (day-only).
export function xToDate(
  x: number,
  originYmd: string,
  zoom: TimelineZoom,
): { ymd: string; minutes: number | null } {
  const ppd = PX_PER_DAY[zoom];
  const totalDays = x / ppd;
  const dayIndex = Math.floor(totalDays);
  const ymd = addDays(originYmd, dayIndex);
  const snap = snapMinutes(zoom);
  if (snap == null) return { ymd, minutes: null };
  const rawMin = (totalDays - dayIndex) * 1440;
  const minutes = Math.max(0, Math.min(1440 - snap, Math.round(rawMin / snap) * snap));
  return { ymd, minutes };
}

// --- drag math (ADR-166 slice 4) -----------------------------------------
// Turning a horizontal pixel drag into a new placement. Pure and node-testable
// (the sibling of dateToX/xToDate); the component feeds the result to
// placement.buildPatch. Structurally identical to placement.Anchor, kept local
// so this file stays dependency-free (geometry only, no placement import).
export type GAnchor = { ymd: string; minutes: number | null };
export type TimelineDragKind = "move" | "resizeStart" | "resizeEnd";

// An anchor as absolute minutes from the origin day's midnight (day + intraday).
function units(origin: string, a: GAnchor): number {
  return daysBetween(origin, a.ymd) * 1440 + (a.minutes ?? 0);
}
// Inverse: absolute minutes → an anchor. `hadTime` preserves the anchor's own
// precision — a day-only field never gains an invented time-of-day.
function fromUnits(origin: string, u: number, hadTime: boolean): GAnchor {
  const dayIndex = Math.floor(u / 1440);
  return { ymd: addDays(origin, dayIndex), minutes: hadTime ? u - dayIndex * 1440 : null };
}

// Shift ONE anchor by a pixel delta, honoring both the zoom's snap and the
// anchor's precision: a day-only anchor (scheduled/due/note/custom date) moves
// in whole days; a timed anchor (meeting/end, or a task's scheduledTime block)
// snaps to the slot at fine zoom, or moves in whole days keeping its time at
// coarse zoom (where there is no sub-day snap to land on).
function shiftAnchor(origin: string, a: GAnchor, deltaPx: number, zoom: TimelineZoom): GAnchor {
  const deltaDays = deltaPx / pxPerDay(zoom);
  const snap = snapMinutes(zoom);
  if (a.minutes == null || snap == null) {
    return { ymd: addDays(a.ymd, Math.round(deltaDays)), minutes: a.minutes };
  }
  const snapped = Math.round((units(origin, a) + deltaDays * 1440) / snap) * snap;
  return fromUnits(origin, snapped, true);
}

// Apply a drag to a placement and return the desired {start, end} (which
// placement.buildPatch turns into a PATCH). Move shifts both edges by the same
// amount so the span is preserved exactly; the resizes move one edge and clamp
// so the span stays positive (at least a day when either edge is a calendar day,
// else one snap slot). Callers guard capability (can.move / can.resize*) before
// invoking — a single-anchor item passes end=null and only "move" is meaningful.
export function applyTimelineDrag(
  kind: TimelineDragKind,
  origin: string,
  start: GAnchor,
  end: GAnchor | null,
  deltaPx: number,
  zoom: TimelineZoom,
): { start: GAnchor; end: GAnchor | null } {
  // Minimum span the resizes preserve: a whole day when either edge is a
  // calendar-day field (a "2,880-minute" span is meaningless there), else a slot.
  const dayOnly = start.minutes == null || (end != null && end.minutes == null);
  const minGap = dayOnly ? 1440 : snapMinutes(zoom) ?? 1440;

  if (kind === "move") {
    const ns = shiftAnchor(origin, start, deltaPx, zoom);
    if (!end) return { start: ns, end: null };
    const shift = units(origin, ns) - units(origin, start);
    return { start: ns, end: fromUnits(origin, units(origin, end) + shift, end.minutes != null) };
  }
  if (kind === "resizeStart") {
    if (!end) return { start, end };
    let ns = shiftAnchor(origin, start, deltaPx, zoom);
    if (units(origin, ns) > units(origin, end) - minGap) {
      ns = fromUnits(origin, units(origin, end) - minGap, start.minutes != null);
    }
    return { start: ns, end };
  }
  // resizeEnd
  if (!end) return { start, end };
  let ne = shiftAnchor(origin, end, deltaPx, zoom);
  if (units(origin, ne) < units(origin, start) + minGap) {
    ne = fromUnits(origin, units(origin, start) + minGap, end.minutes != null);
  }
  return { start, end: ne };
}

// A ruler tick: its x offset, a label, and whether it's a major (labeled,
// stronger) gridline.
export type Tick = { x: number; label: string; major: boolean };

// Generate ruler ticks across [originYmd, originYmd + spanDays). The interval
// and labels adapt to the zoom; majors mark the coarser boundary (day/month/
// year) so the eye can orient while scrolling.
export function ticks(originYmd: string, spanDays: number, zoom: TimelineZoom): Tick[] {
  const ppd = PX_PER_DAY[zoom];
  const out: Tick[] = [];
  if (zoom === "hour" || zoom === "day") {
    // Intraday ticks; major at midnight (the day boundary).
    const stepHours = zoom === "hour" ? 1 : 3;
    for (let d = 0; d < spanDays; d++) {
      const ymd = addDays(originYmd, d);
      for (let h = 0; h < 24; h += stepHours) {
        const x = (d + h / 24) * ppd;
        out.push({
          x,
          major: h === 0,
          label: h === 0 ? shortDay(ymd) : `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`,
        });
      }
    }
    return out;
  }
  if (zoom === "week" || zoom === "month") {
    // One tick per day; major on Mondays (week) or month-firsts (month).
    for (let d = 0; d < spanDays; d++) {
      const ymd = addDays(originYmd, d);
      const dow = utcDow(ymd);
      const dnum = Number(ymd.slice(8, 10));
      const monthStart = dnum === 1;
      const major = zoom === "week" ? dow === 1 : monthStart;
      out.push({
        x: d * ppd,
        major,
        label: monthStart ? monthDay(ymd) : String(dnum),
      });
    }
    return out;
  }
  // quarter/year/halfDecade: one tick per week or month; major on month/year.
  const perMonth = zoom === "quarter";
  for (let d = 0; d < spanDays; d++) {
    const ymd = addDays(originYmd, d);
    const dnum = Number(ymd.slice(8, 10));
    if (perMonth ? dnum % 7 === 1 : dnum !== 1) continue;
    const monthStart = dnum === 1;
    const yearStart = ymd.slice(5) === "01-01";
    out.push({
      x: d * ppd,
      major: perMonth ? monthStart : yearStart,
      label: yearStart ? ymd.slice(0, 4) : monthStart ? monthShort(ymd) : String(dnum),
    });
  }
  return out;
}

// --- pure date helpers (UTC, ADR-008) ------------------------------------

function utcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDays(ymd: string, days: number): string {
  const d = new Date(utcMs(ymd) + days * 86_400_000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
function utcDow(ymd: string): number {
  return new Date(utcMs(ymd)).getUTCDay();
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function monthDay(ymd: string): string {
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
}
function monthShort(ymd: string): string {
  return MONTHS[Number(ymd.slice(5, 7)) - 1];
}
function shortDay(ymd: string): string {
  return `${DOW[utcDow(ymd)]} ${Number(ymd.slice(8, 10))}`;
}
const p2 = (n: number) => String(n).padStart(2, "0");
