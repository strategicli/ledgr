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
