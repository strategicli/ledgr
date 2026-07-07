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
