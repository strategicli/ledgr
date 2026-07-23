// Pure timezone conversions, shared by server code (today.ts, queries) and the
// client (the Planner's placement layer). No DB, no React, no env-at-import
// beyond the fallback constant, so it is safe to import from a client bundle.
// Extracted from today.ts (which imports the DB and stays server-only); today.ts
// now re-exports these for its existing callers, so nothing else changes.
//
// Two day models live in the app (ADR-008): calendar-day fields (scheduled/due/
// note) are UTC-midnight and never touch these helpers; real instants
// (meeting_at/end_at) do, converting to and from the owner's wall clock here.

export type Ymd = { y: number; m: number; d: number };

// The fallback timezone before an owner zone is known: LEDGR_TIMEZONE, else
// America/New_York. Prefer passing an explicit tz; this is the safe default.
export const DEFAULT_TIMEZONE = process.env.LEDGR_TIMEZONE || "America/New_York";
export const APP_TIMEZONE = DEFAULT_TIMEZONE;

export function partsInZone(instant: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(instant)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return p as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

export function ymdInZone(instant: Date, tz: string): Ymd {
  const p = partsInZone(instant, tz);
  return { y: p.year, m: p.month, d: p.day };
}

// The UTC instant of 00:00 on the given calendar date in tz. Guess UTC
// midnight, then correct by the zone's displayed offset; the second pass
// converges across DST transitions (no date math library, rule 5).
export function zonedMidnightUtc({ y, m, d }: Ymd, tz: string): Date {
  const target = Date.UTC(y, m - 1, d);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(new Date(ts), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ts += target - shown;
  }
  return new Date(ts);
}

// Wall-clock minutes since local midnight for an instant in tz (0–1439).
export function minutesInZone(instant: Date, tz: string): number {
  const p = partsInZone(instant, tz);
  return p.hour * 60 + p.minute;
}

// Compose a local calendar day + minutes-since-midnight in tz into the UTC
// instant. Same guess-and-correct convergence as zonedMidnightUtc, but the
// target carries the hour/minute so a DST-day time lands on the right instant.
export function zonedInstant(ymd: Ymd, minutes: number, tz: string): Date {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const target = Date.UTC(ymd.y, ymd.m - 1, ymd.d, hh, mm);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(new Date(ts), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ts += target - shown;
  }
  return new Date(ts);
}
