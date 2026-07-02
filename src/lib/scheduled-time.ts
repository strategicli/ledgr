// Stage A of calendar time-blocking (explorations/calendar-time-blocking.md):
// an optional start time + duration layered on a task's scheduled CALENDAR DAY.
//
// The day stays the zone-free anchor (`scheduled_date`, a UTC-midnight calendar
// day, ADR-008) so every existing day-based query — Today, recurrence math, the
// overdue roll, relative subtasks, the focus layer — keeps working untouched.
// The time is a *refinement* of that day, stored in
// `properties.scheduledTime = { start: "HH:MM", durationMinutes: N }`.
//
// Time is **floating local wall-clock** (no zone): a single-user plan ("I'll work
// 2:00–3:30") that renders at that clock time wherever the calendar is viewed,
// not a fixed UTC instant. This is the one new thing a time introduces that the
// all-day model sidesteps; floating is the right call for one user in one zone.
//
// `properties`-first (no column, not core); promoting to real columns is the
// later ADR step once the shape is proven. Pure + node/edge-safe so the canvas
// control, the ICS feed assembler, and the verify script share one source of
// truth.

export type ScheduledTime = {
  start: string; // "HH:MM" 24h, floating local
  durationMinutes: number; // > 0
};

// The block length used when a start is set without an explicit duration.
export const DEFAULT_DURATION_MINUTES = 60;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidStart(value: unknown): value is string {
  return typeof value === "string" && HHMM.test(value);
}

// Read + validate properties.scheduledTime. Returns null for absent, malformed,
// or JSON-null (the shape a cleared control writes). A start without a valid,
// positive duration falls back to the default rather than rejecting the block.
export function parseScheduledTime(properties: unknown): ScheduledTime | null {
  if (typeof properties !== "object" || properties === null) return null;
  const st = (properties as Record<string, unknown>).scheduledTime;
  if (typeof st !== "object" || st === null) return null;
  const start = (st as Record<string, unknown>).start;
  if (!isValidStart(start)) return null;
  const raw = (st as Record<string, unknown>).durationMinutes;
  const durationMinutes =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? Math.round(raw)
      : DEFAULT_DURATION_MINUTES;
  return { start, durationMinutes };
}

// Minutes since midnight for an "HH:MM" start.
export function startMinutes(t: ScheduledTime): number {
  const [h, m] = t.start.split(":").map(Number);
  return h * 60 + m;
}

// The block's end as minutes since the start day's midnight (may exceed 1440 if
// the block crosses midnight — the caller decides how to render the day rollover).
export function endMinutes(t: ScheduledTime): number {
  return startMinutes(t) + t.durationMinutes;
}

// Split a minutes-since-midnight value into a calendar-day offset (0 = same day,
// 1 = next day) and the wall-clock "HH:MM" within that day. Lets a timed block
// roll past midnight without the helper needing the actual date.
export function splitMinutes(minutes: number): { dayOffset: number; hhmm: string } {
  const dayOffset = Math.floor(minutes / 1440);
  const within = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(within / 60);
  const m = within % 60;
  return { dayOffset, hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

// "HH:MM" (24h) → "h:MM AM/PM" for display.
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

// A compact duration label, e.g. "45m", "1h", "1h 30m" — for the live resize
// readout and block hints.
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

// A human range label for the canvas hint, answering Brandon's "start/end"
// framing from the stored start + duration, e.g. "2:00 PM – 3:30 PM" or, across
// midnight, "11:30 PM – 12:30 AM (+1d)".
export function formatRange(t: ScheduledTime): string {
  const end = splitMinutes(endMinutes(t));
  const suffix = end.dayOffset > 0 ? ` (+${end.dayOffset}d)` : "";
  return `${formatTime12(t.start)} – ${formatTime12(end.hhmm)}${suffix}`;
}
