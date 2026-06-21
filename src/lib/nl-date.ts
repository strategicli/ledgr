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
  makeRecurrence,
  nextOccurrenceOnOrAfter,
  WEEKDAYS,
  WEEKDAY_LABELS,
  weekdayOf,
  type Frequency,
  type RecurrenceRule,
  type Weekday,
} from "@/lib/recurrence";
import { type Urgency } from "@/lib/item-enums";

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

// ===========================================================================
// Natural-language quick-add: parse date + recurrence + urgency OUT OF a task
// TITLE (Tasks Polish S4, ADR-084). Todoist-style strip-and-confirm — the
// recognized tokens are detected and removed, leaving a clean title. Pure +
// client-safe (the caller passes today), the same constrained-grammar discipline
// as parseNaturalDate (Principle 3 — explicit tokens, never an NLP guess; the
// UI shows what was detected so a false positive is one click to reject).

const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// Date-phrase patterns scanned anywhere in the title, most specific first. Bare
// 3-letter weekday abbreviations (mon/tue/…) are deliberately EXCLUDED — they
// collide with ordinary words ("sat", "wed", "sun") and parse-on-save can't ask;
// full weekday names + the explicit numeric/relative forms are unambiguous.
const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\bin \d{1,3} (?:days?|weeks?|months?)\b/,
  /\bnext (?:week|month|weekend)\b/,
  /\b(?:this )?weekend\b/,
  new RegExp(`\\b(?:${MONTH_ALT}) \\d{1,2}(?:,? \\d{4})?\\b`),
  new RegExp(`\\b\\d{1,2} (?:${MONTH_ALT})\\b`),
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  /\b(?:today|tomorrow|tonight|yesterday|tmrw)\b/,
];

const WEEKDAY_ALT =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun";

// p1..p4 (Todoist) and !1..!4 → Ledgr urgencies. p1 = most urgent.
const URGENCY_BY_LEVEL: Record<string, Urgency> = {
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
};

export type TaskTitleDetection = {
  field: "scheduled" | "due" | "recurrence" | "urgency";
  label: string; // human chip label, e.g. "Tomorrow", "Weekly", "Critical"
  source: string; // the exact text removed from the title
};

export type ParsedTaskTitle = {
  title: string; // cleaned title (detected tokens stripped)
  scheduledDate: string | null;
  dueDate: string | null;
  recurrence: RecurrenceRule | null;
  urgency: Urgency | null;
  detections: TaskTitleDetection[];
};

// Remove the first match of `re` from BOTH the lowercase (matching) and original
// (output) strings at the same span, keeping them length-synced. Returns the
// matched (trimmed, lowercased) text, or null.
function stripFirst(
  state: { lower: string; orig: string },
  re: RegExp
): string | null {
  const m = state.lower.match(re);
  if (!m || m.index === undefined) return null;
  const i = m.index;
  const len = m[0].length;
  const text = m[0].trim();
  state.lower = `${state.lower.slice(0, i)} ${state.lower.slice(i + len)}`;
  state.orig = `${state.orig.slice(0, i)} ${state.orig.slice(i + len)}`;
  return text;
}

type RecMatch = {
  freq: Frequency;
  interval: number;
  byDay?: Weekday[];
  label: string;
  source: string; // the exact text stripped (for inline highlighting)
};

const FULL_WEEKDAY: Record<Weekday, string> = {
  MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday",
  FR: "Friday", SA: "Saturday", SU: "Sunday",
};

const SHORT_WEEKDAY: Record<string, Weekday> = {
  mon: "MO", monday: "MO",
  tue: "TU", tues: "TU", tuesday: "TU",
  wed: "WE", weds: "WE", wednesday: "WE",
  thu: "TH", thur: "TH", thurs: "TH", thursday: "TH",
  fri: "FR", friday: "FR",
  sat: "SA", saturday: "SA",
  sun: "SU", sunday: "SU",
};

// Match + strip a recurrence phrase. Returns the rule shape (interval/byDay) plus
// a human label; the caller supplies dtstart.
function matchRecurrence(state: { lower: string; orig: string }): RecMatch | null {
  // "every weekday" / "weekdays" → Mon–Fri
  {
    const src = stripFirst(state, /\b(?:every weekday|weekdays)\b/);
    if (src) return { freq: "weekly", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"], label: "Every weekday", source: src };
  }
  // "every <weekday>" → that weekday
  const wd = state.lower.match(new RegExp(`\\bevery (${WEEKDAY_ALT})\\b`));
  if (wd && wd.index !== undefined) {
    const src = stripFirst(state, new RegExp(`\\bevery (?:${WEEKDAY_ALT})\\b`)) ?? wd[0];
    const day = SHORT_WEEKDAY[wd[1]];
    return { freq: "weekly", interval: 1, byDay: [day], label: `Every ${FULL_WEEKDAY[day]}`, source: src };
  }
  // "every N days|weeks|months|years"
  const everyN = state.lower.match(/\bevery (\d{1,3}) (day|week|month|year)s?\b/);
  if (everyN && everyN.index !== undefined) {
    const n = Number(everyN[1]);
    const unit = everyN[2] as "day" | "week" | "month" | "year";
    const src = stripFirst(state, /\bevery \d{1,3} (?:day|week|month|year)s?\b/) ?? everyN[0];
    const freq: Frequency = unit === "day" ? "daily" : unit === "week" ? "weekly" : unit === "month" ? "monthly" : "yearly";
    return { freq, interval: n, label: `Every ${n} ${unit}s`, source: src };
  }
  // single-word + "every day/week/month/year"
  const simple: [RegExp, Frequency, string][] = [
    [/\b(?:every day|daily)\b/, "daily", "Daily"],
    [/\b(?:every week|weekly)\b/, "weekly", "Weekly"],
    [/\b(?:every month|monthly)\b/, "monthly", "Monthly"],
    [/\b(?:every year|yearly|annually)\b/, "yearly", "Yearly"],
  ];
  for (const [re, freq, label] of simple) {
    const src = stripFirst(state, re);
    if (src) return { freq, interval: 1, label, source: src };
  }
  return null;
}

// Match + strip a date phrase, optionally requiring a `by ` prefix (→ a due
// deadline). Returns the resolved YMD + the removed text.
function matchDate(
  state: { lower: string; orig: string },
  todayYmd: string,
  withBy: boolean
): { ymd: string; source: string } | null {
  for (const pat of DATE_PATTERNS) {
    const re = withBy
      ? new RegExp(`\\bby ${pat.source.replace(/^\\b/, "")}`)
      : pat;
    const m = state.lower.match(re);
    if (!m || m.index === undefined) continue;
    const phrase = m[0].replace(/^by /, "").trim();
    const ymd = parseNaturalDate(phrase, todayYmd);
    if (!ymd) continue;
    stripFirst(state, re);
    return { ymd, source: phrase };
  }
  return null;
}

function matchUrgency(
  state: { lower: string; orig: string }
): { urgency: Urgency; source: string } | null {
  // pN is word-boundary safe; !N is not (`!` is non-word, so `\b` never sits
  // before it) — anchor it on a preceding space/start instead.
  let re = /\bp([1-6])\b/;
  let m = state.lower.match(re);
  if (!m) {
    re = /(?:^|\s)!([1-6])\b/;
    m = state.lower.match(re);
  }
  if (!m || m.index === undefined) return null;
  const level = m[1];
  const source = m[0].trim();
  stripFirst(state, re);
  return { urgency: URGENCY_BY_LEVEL[level], source };
}

// Parse a task title into a clean title + detected scheduled date, due deadline
// ("by <date>"), recurrence (→ a stored RRULE via makeRecurrence), and urgency
// (p1..p4 / !1..!4). Unmatched text is left untouched. Order matters: recurrence
// is stripped before dates so "every monday" isn't also read as a weekday date.
export function parseTaskTitle(input: string, todayYmd: string): ParsedTaskTitle {
  const empty: ParsedTaskTitle = {
    title: input.trim(),
    scheduledDate: null,
    dueDate: null,
    recurrence: null,
    urgency: null,
    detections: [],
  };
  if (!isYmd(todayYmd) || !input.trim()) return empty;

  // Pad with spaces so \b patterns at the very ends still match cleanly.
  const state = { lower: ` ${input.toLowerCase()} `, orig: ` ${input} ` };
  const detections: TaskTitleDetection[] = [];

  const rec = matchRecurrence(state);
  const due = matchDate(state, todayYmd, true);
  if (due) detections.push({ field: "due", label: `By ${formatChipDate(due.ymd)}`, source: due.source });
  const sched = matchDate(state, todayYmd, false);
  if (sched) detections.push({ field: "scheduled", label: formatChipDate(sched.ymd), source: sched.source });
  const urg = matchUrgency(state);
  if (urg) detections.push({ field: "urgency", label: `P${urg.urgency}`, source: urg.source });

  let scheduledDate = sched?.ymd ?? null;
  let recurrence: RecurrenceRule | null = null;
  if (rec) {
    const dtstart = scheduledDate ?? todayYmd;
    recurrence = makeRecurrence({ freq: rec.freq, interval: rec.interval, byDay: rec.byDay, dtstart });
    // No explicit date with a repeat: schedule the first occurrence.
    if (!scheduledDate) scheduledDate = nextOccurrenceOnOrAfter(recurrence, todayYmd) ?? dtstart;
    detections.unshift({ field: "recurrence", label: rec.label, source: rec.source });
  }

  return {
    title: state.orig.replace(/\s+/g, " ").trim(),
    scheduledDate,
    dueDate: due?.ymd ?? null,
    recurrence,
    urgency: urg?.urgency ?? null,
    detections,
  };
}

// "2026-06-20" → "Jun 20" (short chip label; the date field shows the full date).
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatChipDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}
