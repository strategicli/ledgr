// Shared "when" formatting for the event lenses (Calendar feed + Timeline).
// A meeting time shows weekday + month/day + time in the owner's timezone; drop
// the year when it's the current year, add it otherwise. Pure — safe on server
// and client; the caller passes the resolved timezone (getAppTimezone) so this
// stays free of any DB/settings dependency.
import { DEFAULT_TIMEZONE } from "@/lib/today";

// Formatters are keyed by timezone and reused, so re-rendering a list doesn't
// rebuild an Intl formatter per row (they're comparatively expensive).
const cache = new Map<string, { sameYear: Intl.DateTimeFormat; otherYear: Intl.DateTimeFormat; year: Intl.DateTimeFormat }>();

function formatters(tz: string) {
  let fmts = cache.get(tz);
  if (!fmts) {
    fmts = {
      sameYear: new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      }),
      otherYear: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      }),
      year: new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: tz }),
    };
    cache.set(tz, fmts);
  }
  return fmts;
}

export function formatWhen(at: Date, now: Date, tz: string = DEFAULT_TIMEZONE): string {
  const f = formatters(tz);
  return f.year.format(at) === f.year.format(now)
    ? f.sameYear.format(at)
    : f.otherYear.format(at);
}

// Condensed, two-part "when" for narrow surfaces (mobile list rows). The long
// formatWhen ("Mon, Jul 13, 7:00 AM") eats ~160px in a fixed column and starves
// the title on a phone; this splits into a stacked day + time block that fits a
// ~64px column, and relativizes the near dates the way a human would say them.
//   day:  Today / Tomorrow / Yesterday · Mon (within the week) · Jul 13 (this
//         year) · Jul 13 '25 (other year)
//   time: 7a · 1:15p (12-hour, compact, :00 dropped) — "" for undated
//   full: the long formatWhen string, for a hover title / a11y label
// Pure like formatWhen; caller passes the resolved tz. Reuses the cached long
// formatters and adds its own cached short ones.
const shortCache = new Map<
  string,
  {
    dayKey: Intl.DateTimeFormat;
    weekday: Intl.DateTimeFormat;
    monthDay: Intl.DateTimeFormat;
    monthDayYear: Intl.DateTimeFormat;
    time: Intl.DateTimeFormat;
  }
>();

function shortFormatters(tz: string) {
  let f = shortCache.get(tz);
  if (!f) {
    f = {
      // en-CA yields YYYY-MM-DD, a sortable calendar-day key in the target tz.
      dayKey: new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: tz,
      }),
      weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }),
      monthDay: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }),
      monthDayYear: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
        timeZone: tz,
      }),
      time: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: tz,
      }),
    };
    shortCache.set(tz, f);
  }
  return f;
}

// Whole-day difference between two instants in the target tz (at − now), via
// their YYYY-MM-DD keys parsed as UTC midnights so DST never skews the count.
function dayDiff(at: Date, now: Date, keyFmt: Intl.DateTimeFormat): number {
  const a = Date.parse(keyFmt.format(at) + "T00:00:00Z");
  const n = Date.parse(keyFmt.format(now) + "T00:00:00Z");
  return Math.round((a - n) / 86_400_000);
}

// "7:00 AM" → "7a", "1:15 PM" → "1:15p" (drop :00, lowercase meridiem, no space).
function compactTime(s: string): string {
  return s
    .replace(/:00(?=\s)/, "")
    .replace(/\s?AM/i, "a")
    .replace(/\s?PM/i, "p");
}

export function formatWhenShort(
  at: Date | null,
  now: Date,
  tz: string = DEFAULT_TIMEZONE
): { day: string; time: string; full: string } {
  if (!at) return { day: "No date", time: "", full: "No date" };
  const f = shortFormatters(tz);
  const diff = dayDiff(at, now, f.dayKey);
  let day: string;
  if (diff === 0) day = "Today";
  else if (diff === 1) day = "Tomorrow";
  else if (diff === -1) day = "Yesterday";
  else if (diff > 1 && diff < 7) day = f.weekday.format(at); // within the coming week
  else if (f.dayKey.format(at).slice(0, 4) === f.dayKey.format(now).slice(0, 4))
    day = f.monthDay.format(at); // same calendar year
  else day = f.monthDayYear.format(at);
  return { day, time: compactTime(f.time.format(at)), full: formatWhen(at, now, tz) };
}
