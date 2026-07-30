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

// Parse a phrase that may carry a time-of-day on top of a date, for the Schedule
// date box ("5am today", "next fri 2:30pm", "9am"). Returns the calendar day
// (YYYY-MM-DD, defaulting to today when only a time is given) plus an "HH:MM" 24h
// time when one is present. The time token is stripped first so the remainder
// still matches parseNaturalDate's grammar. Same constrained, predictable
// grammar as the rest of this file — a bare hour with no am/pm is left alone
// rather than guessed (Principle 3).
export function parseNaturalWhen(
  input: string,
  todayYmd: string
): { ymd: string | null; time: string | null } {
  if (!isYmd(todayYmd)) return { ymd: null, time: null };
  let raw = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return { ymd: null, time: null };

  // Pull one time token out of the phrase: 12-hour ("5am", "5:30 pm") wins, else
  // a colon'd 24-hour clock ("17:00"). A bare hour with no meridiem/colon is too
  // ambiguous to read as a time, so it's left for the date grammar.
  let time: string | null = null;
  const twelve = raw.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/);
  const twentyFour = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twelve) {
    let h = Number(twelve[1]);
    const m = twelve[2] ? Number(twelve[2]) : 0;
    if (h >= 1 && h <= 12) {
      if (twelve[3] === "am") h = h === 12 ? 0 : h;
      else h = h === 12 ? 12 : h + 12;
      time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      raw = raw.replace(twelve[0], " ");
    }
  } else if (twentyFour) {
    time = `${twentyFour[1].padStart(2, "0")}:${twentyFour[2]}`;
    raw = raw.replace(twentyFour[0], " ");
  }

  // Drop a connecting "at"/"@" the time left behind ("tomorrow at 9am" → "tomorrow").
  raw = raw.replace(/\b(?:at|@)\b/g, " ").replace(/\s+/g, " ").trim();

  // A time with no remaining date phrase means today; otherwise parse what's left.
  const ymd = raw ? parseNaturalDate(raw, todayYmd) : time ? todayYmd : null;
  return { ymd, time };
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
  byDayOrdinal?: { ordinal: number; weekday: Weekday }[];
  byMonthDay?: number[];
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

// Monthly ordinal positions ("first Sunday", "3rd of the month"). -1 = last.
const ORDINAL_TO_NUM: Record<string, number> = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3,
  fourth: 4, "4th": 4, fifth: 5, "5th": 5, last: -1,
};
const NUM_TO_ORDINAL_WORD: Record<number, string> = {
  [-1]: "Last", 1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth",
};
const ORDINAL_ALT = "first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th";
const WEEKDAY_FULL_ALT = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

// Match + strip a recurrence phrase. Returns the rule shape (interval/byDay) plus
// a human label; the caller supplies dtstart.
function matchRecurrence(state: { lower: string; orig: string }): RecMatch | null {
  // "every weekday" / "weekdays" → Mon–Fri
  {
    const src = stripFirst(state, /\b(?:every weekday|weekdays)\b/);
    if (src) return { freq: "weekly", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"], label: "Every weekday", source: src };
  }
  // "[the] <ordinal>[ and <ordinal>…] <weekday> [of the month]" → monthly nth-weekday.
  // e.g. "first sunday of the month", "the third thursday", "first and second thursday".
  {
    const re = new RegExp(`\\b(?:the )?((?:${ORDINAL_ALT})(?:(?:,| and| &) (?:${ORDINAL_ALT}))*) (${WEEKDAY_FULL_ALT})(?: of (?:the|every) month)?\\b`);
    const m = state.lower.match(re);
    if (m && m.index !== undefined) {
      const weekday = SHORT_WEEKDAY[m[2]];
      const ordinals = m[1]
        .split(/\s*(?:,|and|&)\s*/)
        .map((t) => ORDINAL_TO_NUM[t.trim()])
        .filter((n): n is number => n !== undefined);
      if (weekday && ordinals.length) {
        const src = stripFirst(state, re) ?? m[0].trim();
        const byDayOrdinal = ordinals.map((ordinal) => ({ ordinal, weekday }));
        const label = `${ordinals.map((n) => NUM_TO_ORDINAL_WORD[n]).join(" & ")} ${FULL_WEEKDAY[weekday]}`;
        return { freq: "monthly", interval: 1, byDayOrdinal, label, source: src };
      }
    }
  }
  // "[the] <Nth> of the month" → monthly day-of-month. e.g. "3rd of the month", "last of the month".
  {
    const re = new RegExp(`\\b(?:the )?(${ORDINAL_ALT}|\\d{1,2}(?:st|nd|rd|th)) of (?:the|every) month\\b`);
    const m = state.lower.match(re);
    if (m && m.index !== undefined) {
      const tok = m[1];
      const day = ORDINAL_TO_NUM[tok] ?? Number(tok.replace(/\D/g, ""));
      if (day === -1 || (day >= 1 && day <= 31)) {
        const src = stripFirst(state, re) ?? m[0].trim();
        const label = day === -1 ? "Last day" : `Day ${day}`;
        return { freq: "monthly", interval: 1, byMonthDay: [day], label, source: src };
      }
    }
  }
  // "every other <weekday>" → biweekly on that weekday (INTERVAL=2 + BYDAY).
  const otherWd = state.lower.match(new RegExp(`\\bevery other (${WEEKDAY_ALT})\\b`));
  if (otherWd && otherWd.index !== undefined) {
    const src = stripFirst(state, new RegExp(`\\bevery other (?:${WEEKDAY_ALT})\\b`)) ?? otherWd[0];
    const day = SHORT_WEEKDAY[otherWd[1]];
    return { freq: "weekly", interval: 2, byDay: [day], label: `Every other ${FULL_WEEKDAY[day]}`, source: src };
  }
  // "every other day|week|month|year" → INTERVAL=2 of that unit.
  {
    const m = state.lower.match(/\bevery other (day|week|month|year)\b/);
    if (m && m.index !== undefined) {
      const unit = m[1] as "day" | "week" | "month" | "year";
      const src = stripFirst(state, /\bevery other (?:day|week|month|year)\b/) ?? m[0];
      const freq: Frequency = unit === "day" ? "daily" : unit === "week" ? "weekly" : unit === "month" ? "monthly" : "yearly";
      return { freq, interval: 2, label: `Every other ${unit}`, source: src };
    }
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
    recurrence = makeRecurrence({ freq: rec.freq, interval: rec.interval, byDay: rec.byDay, byDayOrdinal: rec.byDayOrdinal, byMonthDay: rec.byMonthDay, dtstart });
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

// ===========================================================================
// BACKWARD-LOOKING FUZZY dates for search (ADR-172). parseNaturalDate above is
// forward-looking and point-shaped on purpose — its job is putting a task on one
// future day. Searching for a half-remembered item is the opposite: the phrases
// look backward ("about a month ago"), and some of them are RANGES rather than
// points ("within the last week" means everything from a week ago until now).
//
// So this returns a range plus a softness, never a single day. Three phrase
// shapes all collapse into that one return type, which is why the scorer needs
// only one formula:
//
//   "within the last week"   -> [today-7, today]      a recent range
//   "about a month ago"      -> [target-15, target+15] centered, half-span wide
//   "at least 6 months ago"  -> [null, today-180]      open-ended backward
//
// The score is then 1/(1 + (days_outside_range / softDays)^sharpness), where the
// SHARPNESS comes from the owner's confidence dial, not from here (lib/
// search-deep.ts). This function answers "where and how wide"; the dial answers
// "how hard are the edges". A date criterion is never a hard filter at any
// confidence, so nothing here is a cutoff — `from`/`to` bound a plateau, not a
// WHERE clause.
//
// Same discipline as the rest of this file: a small explicit grammar, null when
// it doesn't understand (the caller keeps its plain date inputs), no NLP model.

export type FuzzyWhen = {
  // The plateau: inside it, an item scores ~1.0. null = open-ended on that side
  // ("at least a year ago" has no lower bound).
  from: string | null; // YYYY-MM-DD inclusive
  to: string | null; // YYYY-MM-DD inclusive
  // Decay scale in days for dates OUTSIDE the plateau. Derived as half the stated
  // distance, so a vaguer phrase self-fuzzes: "6 months ago" gets ±90 days of
  // plateau and a 90-day decay scale, "3 days ago" gets ±1.5.
  softDays: number;
  // Human echo for the UI chip ("around Jun 29 · ± 2 weeks"), so the owner can
  // see what was understood before trusting it.
  label: string;
};

// Spelled-out counts that show up in date phrases ("two weeks ago"). Deliberately
// a local 1-12 map rather than importing lib/synonyms.ts: that module pulls in a
// ~1.8MB WordNet JSON, and this file is client-safe and shipped with task capture.
const SMALL_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  couple: 2, few: 3, several: 4,
};

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

// "two" | "2" -> 2. null when it's neither.
function countOf(token: string): number | null {
  if (/^\d{1,4}$/.test(token)) return Number(token);
  return SMALL_NUMBERS[token] ?? null;
}

// 15 -> "2 weeks", 90 -> "3 months", 2 -> "2 days". Keeps the chip readable.
function humanizeDays(days: number): string {
  const round = (n: number) => Math.max(1, Math.round(n));
  if (days >= 60) return `${round(days / 30)} months`;
  if (days >= 14) return `${round(days / 7)} weeks`;
  return `${round(days)} day${round(days) === 1 ? "" : "s"}`;
}

/**
 * Parse a backward-looking, deliberately vague date phrase into a scored range.
 * Returns null when the phrase isn't understood, so the caller can fall back to
 * explicit date inputs rather than searching a window the owner never asked for.
 *
 * Understood shapes (all case-insensitive):
 *   within/in the last N days|weeks|months   ·  past N weeks  ·  last few days
 *   N weeks|months|years ago  ·  about/around/roughly a month ago  ·  last month
 *   at least|more than|over N months ago  ·  older than a year  ·  before <date>
 */
export function parseFuzzyWhen(input: string, todayYmd: string): FuzzyWhen | null {
  if (!isYmd(todayYmd)) return null;
  const raw = input.trim().toLowerCase().replace(/\s+/g, " ").replace(/[~?]/g, "").trim();
  if (!raw) return null;

  const unitAlt = "days?|weeks?|months?|years?";
  const countAlt = `\\d{1,4}|${Object.keys(SMALL_NUMBERS).join("|")}`;
  const spanOf = (countTok: string, unitTok: string): number | null => {
    const n = countOf(countTok);
    const unit = UNIT_DAYS[unitTok.replace(/s$/, "")];
    return n && unit ? n * unit : null;
  };

  // --- "at least / more than / over / older than N units [ago]" -> open backward.
  {
    const m = raw.match(
      new RegExp(`^(?:at least|more than|over|older than|before) (${countAlt}) (${unitAlt})(?: ago)?$`)
    );
    if (m) {
      const span = spanOf(m[1], m[2]);
      if (span) {
        const cutoff = addDaysYmd(todayYmd, -span);
        return {
          from: null,
          to: cutoff,
          softDays: Math.max(1, span / 2),
          label: `before ${formatChipDate(cutoff)}`,
        };
      }
    }
  }

  // --- "before <any date phrase>" -> open backward from that day.
  {
    const m = raw.match(/^before (.+)$/);
    if (m) {
      const cutoff = parseNaturalDate(m[1], todayYmd);
      if (cutoff) {
        return { from: null, to: cutoff, softDays: 30, label: `before ${formatChipDate(cutoff)}` };
      }
    }
  }

  // --- A recent range ending today: "within the last week", "past few weeks",
  // "last month sometime", "sometime last month", "previous 2 weeks". The count is
  // optional ("last week" = the past one week), and "sometime" is accepted on
  // either end since both readings get typed.
  //
  // "last month" is deliberately read as "the past ~30 days" rather than the
  // strict calendar month: someone hunting a half-remembered item means the
  // former, and a calendar-month reading would exclude an item from three days ago.
  {
    const m = raw.match(
      new RegExp(
        `^(?:sometime )?(?:within |in |over )?(?:the )?(?:last|past|previous) ` +
          `(?:(${countAlt}) )?(${unitAlt})(?: sometime)?$`
      )
    );
    if (m) {
      const span = spanOf(m[1] ?? "1", m[2]);
      if (span) {
        const from = addDaysYmd(todayYmd, -span);
        return {
          from,
          to: todayYmd,
          softDays: Math.max(1, span / 2),
          label: `${formatChipDate(from)} – ${formatChipDate(todayYmd)}`,
        };
      }
    }
  }

  // --- "N units ago", with optional vagueness words -> centered on that point.
  // "last month" / "last week" land here too (count defaults to 1): treated as
  // "about a month ago" rather than the strict calendar month, which is what a
  // person searching for a half-remembered item actually means.
  {
    const m = raw.match(
      new RegExp(
        `^(?:about|around|roughly|approximately|sometime|maybe )?\\s*` +
          `(?:(${countAlt}) )?(${unitAlt})(?: ago| back)?(?: sometime)?$`
      )
    );
    if (m) {
      const span = spanOf(m[1] ?? "1", m[2]);
      if (span) {
        const target = addDaysYmd(todayYmd, -span);
        const soft = Math.max(1, span / 2);
        const from = addDaysYmd(target, -Math.round(soft));
        const to = addDaysYmd(target, Math.round(soft));
        return {
          from,
          // Never claim a plateau that runs into the future.
          to: to > todayYmd ? todayYmd : to,
          softDays: soft,
          label: `around ${formatChipDate(target)} · ± ${humanizeDays(soft)}`,
        };
      }
    }
  }

  // --- A plain date or forward-grammar phrase ("jun 20", "2026-06-01") -> a tight
  // plateau on that day. Lets the same box accept an exact date without a mode switch.
  {
    const exact = parseNaturalDate(raw, todayYmd);
    if (exact) {
      return { from: exact, to: exact, softDays: 3, label: formatChipDate(exact) };
    }
  }

  return null;
}
