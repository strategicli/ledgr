// Natural-language date parsing for task capture + reschedule (T2, ADR-073).
// Matches Todoist's NL dates ("tomorrow", "next friday", "in 3 days", "jun 20")
// with a small hand-rolled parser — no chrono-node or other heavy dependency
// (Principle 5). PURE + client-safe: returns a calendar day (YYYY-MM-DD) given
// the phrase and a reference "today" (the caller passes it, so this is
// deterministic and testable), matching the UTC-midnight calendar-day
// convention the scheduled/due columns use (ADR-008/076).
//
// Deliberately a constrained, predictable grammar (a planner types a handful of
// shapes) rather than an open-ended NLP model — Principle 3.
import {
  addDaysYmd,
  addMonthsYmd,
  isYmd,
  WEEKDAYS,
  weekdayOf,
  type Weekday,
} from "@/lib/recurrence";

const WEEKDAY_NAMES: Record<string, Weekday> = {
  sun: "SU", sunday: "SU",
  mon: "MO", monday: "MO",
  tue: "TU", tues: "TU", tuesday: "TU",
  wed: "WE", weds: "WE", wednesday: "WE",
  thu: "TH", thur: "TH", thurs: "TH", thursday: "TH",
  fri: "FR", friday: "FR",
  sat: "SA", saturday: "SA",
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// Days from `from` to the next occurrence of weekday `wd`. `includeToday`:
// "monday" said on a Monday means today; "next monday" always jumps a week.
function daysToWeekday(fromYmd: string, wd: Weekday, includeToday: boolean): number {
  const fromIdx = WEEKDAYS.indexOf(weekdayOf(fromYmd));
  const toIdx = WEEKDAYS.indexOf(wd);
  let delta = (toIdx - fromIdx + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return delta;
}

// Parse a natural-language date phrase relative to `todayYmd`. Returns a
// YYYY-MM-DD calendar day, or null if the phrase isn't understood (the caller
// then leaves the field unset rather than guessing).
export function parseNaturalDate(input: string, todayYmd: string): string | null {
  if (!isYmd(todayYmd)) return null;
  const raw = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;

  // An explicit ISO date wins outright. (Ternary, not an early `if (isYmd(raw))`,
  // so the `value is string` guard doesn't narrow `raw` to never below.)
  const asIso = isYmd(raw) ? raw : null;
  if (asIso) return asIso;

  // today / tomorrow / tonight / yesterday
  if (raw === "today" || raw === "tonight" || raw === "tod") return todayYmd;
  if (raw === "tomorrow" || raw === "tmrw" || raw === "tom") return addDaysYmd(todayYmd, 1);
  if (raw === "yesterday") return addDaysYmd(todayYmd, -1);

  // "in N days|weeks|months" and the bare "N days|weeks|months"
  const inMatch = raw.match(/^(?:in )?(\d{1,3}) ?(day|days|week|weeks|month|months|d|w|mo)$/);
  if (inMatch) {
    const n = Number(inMatch[1]);
    const unit = inMatch[2];
    if (unit.startsWith("d")) return addDaysYmd(todayYmd, n);
    if (unit.startsWith("w")) return addDaysYmd(todayYmd, n * 7);
    return addMonthsYmd(todayYmd, n);
  }

  // next week / next month
  if (raw === "next week") return addDaysYmd(todayYmd, 7);
  if (raw === "next month") return addMonthsYmd(todayYmd, 1);

  // weekend → the coming Saturday
  if (raw === "weekend" || raw === "this weekend") {
    return addDaysYmd(todayYmd, daysToWeekday(todayYmd, "SA", true));
  }
  if (raw === "next weekend") {
    return addDaysYmd(todayYmd, daysToWeekday(todayYmd, "SA", false) + 7);
  }

  // weekday names, with optional "next"/"this" prefix
  const wdMatch = raw.match(/^(next |this )?([a-z]+)$/);
  if (wdMatch) {
    const wd = WEEKDAY_NAMES[wdMatch[2]];
    if (wd) {
      const isNext = wdMatch[1]?.trim() === "next";
      const delta = daysToWeekday(todayYmd, wd, !isNext);
      return addDaysYmd(todayYmd, isNext && delta < 7 ? delta + 7 : delta);
    }
  }

  // "jun 20", "june 20", "20 jun", optional year "jun 20 2026"
  const md = raw.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/);
  const dm = raw.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/);
  const monthDay = md
    ? { month: MONTHS[md[1]], day: Number(md[2]), year: md[3] ? Number(md[3]) : undefined }
    : dm
      ? { month: MONTHS[dm[2]], day: Number(dm[1]), year: dm[3] ? Number(dm[3]) : undefined }
      : null;
  if (monthDay && monthDay.month && monthDay.day >= 1 && monthDay.day <= 31) {
    const [ty] = todayYmd.split("-").map(Number);
    const year = monthDay.year ?? ty;
    const candidate = `${year}-${String(monthDay.month).padStart(2, "0")}-${String(monthDay.day).padStart(2, "0")}`;
    if (!isYmd(candidate)) return null;
    // No explicit year + the date already passed this year → roll to next year.
    if (!monthDay.year && candidate < todayYmd) {
      return `${year + 1}-${String(monthDay.month).padStart(2, "0")}-${String(monthDay.day).padStart(2, "0")}`;
    }
    return candidate;
  }

  // Numeric m/d or m/d/yyyy
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const [ty] = todayYmd.split("-").map(Number);
    let year = slash[3] ? Number(slash[3]) : ty;
    if (year < 100) year += 2000;
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isYmd(candidate)) return null;
    if (!slash[3] && candidate < todayYmd) {
      return `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return candidate;
  }

  return null;
}
