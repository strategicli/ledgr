// Native task recurrence engine (T1, ADR-073/ADR-076). The deterministic core
// (Principle 3 — no model anywhere near it) that replaces the recurrence Todoist
// owned (ADR-026). Model (C) from explorations/recurrence-model.md: one task
// item is the series, carrying an RRULE plus a per-date completion log; nothing
// is spawned and nothing stacks. Completing an occurrence stamps its date and
// advances `scheduled` to the next uncompleted occurrence.
//
// PURE + client-safe: calendar-date math only, no DB, no markdown, no zone
// lookups (the caller passes the reference date), so the canvas editor, the MCP
// layer, the ICS feed, and node verify scripts all share one implementation.
//
// Dates are calendar days as `YYYY-MM-DD` strings, computed in UTC. This matches
// the due-date convention (UTC-midnight calendar days, ADR-008) and sidesteps
// DST entirely: a daily task never lands on the wrong day because the clocks
// shifted. Time-of-day (reminder lead times) layers on later (T4), never here.
//
// RRULE is a deliberately CONSTRAINED RFC-5545 subset (Principle 5: justify any
// dependency — the `rrule` npm package is the documented off-ramp if this proves
// too small; see ADR-076). Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL,
// BYDAY (plain weekdays for WEEKLY; ordinal weekdays like 1SU/3TH/-1FR for
// MONTHLY — "the first Sunday", "the third Thursday"), BYMONTHDAY (MONTHLY — "the
// 3rd of the month"; -1 = last day), COUNT, UNTIL. The rule is STORED as a
// standards-shaped string so the ICS feed (T4) can emit it verbatim and a future
// swap to a full library is a drop-in. (Monthly ordinal BYDAY + BYMONTHDAY added
// 2026-06-21 — ADR-076 amendment, Brandon agreed; back-compat, no migration.)

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const FREQ_TO_RRULE: Record<Frequency, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};
const RRULE_TO_FREQ: Record<string, Frequency> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

// Hard cap so a malformed/forever rule can never hang occurrence generation.
// 2000 daily occurrences ≈ 5.5 years; far past any window we render.
const ENUMERATE_CAP = 2000;

// A weekday with an optional monthly ordinal: { ordinal: 1, weekday: "SU" } =
// "the first Sunday"; ordinal -1 = "the last". Serializes to RRULE BYDAY (1SU,
// -1FR). Used for FREQ=MONTHLY only.
export type ByDayOrdinal = { ordinal: number; weekday: Weekday };

export type RRuleParts = {
  freq: Frequency;
  interval: number; // >= 1
  byDay?: Weekday[]; // WEEKLY: plain weekdays the rule fires on
  byDayOrdinal?: ByDayOrdinal[]; // MONTHLY: nth weekday(s) ("1st & 2nd Thursday")
  byMonthDay?: number[]; // MONTHLY: day(s) of month, 1..31 or -1 (last day)
  count?: number; // total occurrences from dtstart
  until?: string; // YYYY-MM-DD inclusive end
};

export type OccurrenceMode = "virtual" | "materialized";
export type AnchorMode = "fixed" | "completion";

// The stored shape, under items.properties.recurrence (jsonb). No new column:
// the rule + logs are owner data over the task, and "next occurrence" is
// computed, never stored as N rows (Principle 8). `scheduled` (the concrete next
// date) IS a column — it is hot (Today, focus, the ICS feed, overdue roll all
// query it), so it follows the schema rule "hot fields are columns."
export type RecurrenceRule = {
  rrule: string; // RFC-5545 RRULE body, no DTSTART (formatRRule output)
  dtstart: string; // YYYY-MM-DD anchor — the first occurrence
  completeInstances: string[]; // YYYY-MM-DD, sorted, deduped
  skippedInstances: string[]; // YYYY-MM-DD, sorted, deduped
  occurrenceMode: OccurrenceMode; // virtual (one item + log) | materialized (item per occurrence)
  anchorMode: AnchorMode; // fixed (calendar) | completion (N units after I finish)
  maintainDueOffset?: boolean; // shift due_date by the same delta when scheduled advances
};

// ---------------------------------------------------------------------------
// Calendar-date helpers (YYYY-MM-DD, UTC). No Date-of-local-zone anywhere.

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

function daysInMonth(year: number, month1: number): number {
  // month1 is 1-12. Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateToYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// A timestamptz instant (the scheduled_date/due_date column shape) to its
// calendar day, and back — the UTC-midnight encoding due dates already use.
export function dateToYmdUtc(date: Date): string {
  return dateToYmd(date);
}
export function ymdToUtcDate(ymd: string): Date {
  return ymdToDate(ymd);
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToYmd(d);
}

// Add months, clamping the day to the target month's length (Jan 31 + 1mo →
// Feb 28/29). The canonical "monthly on the 31st" behavior.
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const totalMonths = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function addYearsYmd(ymd: string, years: number): string {
  return addMonthsYmd(ymd, years * 12);
}

// Monday-based weekday (RRULE/ISO order: MO=0 … SU=6).
export function weekdayOf(ymd: string): Weekday {
  const dow = ymdToDate(ymd).getUTCDay(); // 0=Sun … 6=Sat
  return WEEKDAYS[(dow + 6) % 7];
}

export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ymdOf(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The date of the `ordinal`-th `weekday` in a given month (ordinal -1 = the last
// one). null when it doesn't exist (e.g. a 5th Friday some months lack).
function nthWeekdayOfMonth(
  year: number,
  month1: number,
  weekday: Weekday,
  ordinal: number
): string | null {
  const dim = daysInMonth(year, month1);
  if (ordinal === -1) {
    for (let d = dim; d >= 1; d--) {
      const ymd = ymdOf(year, month1, d);
      if (weekdayOf(ymd) === weekday) return ymd;
    }
    return null;
  }
  let seen = 0;
  for (let d = 1; d <= dim; d++) {
    const ymd = ymdOf(year, month1, d);
    if (weekdayOf(ymd) === weekday && ++seen === ordinal) return ymd;
  }
  return null;
}

// A day-of-month within a given month (day -1 = the last day). null when out of
// range for that month (e.g. day 31 in a 30-day month — that month is skipped).
function monthDayOf(year: number, month1: number, day: number): string | null {
  const dim = daysInMonth(year, month1);
  const d = day === -1 ? dim : day;
  return d >= 1 && d <= dim ? ymdOf(year, month1, d) : null;
}

// ---------------------------------------------------------------------------
// RRULE parse / format (the constrained subset)

export function parseRRule(raw: unknown): RRuleParts | null {
  if (typeof raw !== "string") return null;
  // Tolerate a leading "RRULE:" prefix and any "DTSTART:" segment.
  const body = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^RRULE:/i, ""))
    .find((line) => /FREQ=/i.test(line));
  if (!body) return null;

  const parts: Record<string, string> = {};
  for (const seg of body.split(";")) {
    const [k, v] = seg.split("=");
    if (k && v) parts[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }

  const freq = RRULE_TO_FREQ[parts.FREQ];
  if (!freq) return null;

  const out: RRuleParts = { freq, interval: 1 };

  if (parts.INTERVAL) {
    const n = Number(parts.INTERVAL);
    if (Number.isInteger(n) && n >= 1) out.interval = n;
  }
  if (parts.BYDAY) {
    // A BYDAY token is an optional signed ordinal + a 2-letter weekday: "MO"
    // (plain, weekly) or "1SU"/"-1FR" (ordinal, monthly). Split the two out.
    const plain: Weekday[] = [];
    const ordinal: ByDayOrdinal[] = [];
    for (const tok of parts.BYDAY.split(",").map((d) => d.trim())) {
      const m = tok.match(/^(-?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/);
      if (!m) continue;
      const weekday = m[2] as Weekday;
      if (m[1]) {
        const n = Number(m[1]);
        if (n === -1 || (n >= 1 && n <= 5)) ordinal.push({ ordinal: n, weekday });
      } else {
        plain.push(weekday);
      }
    }
    if (plain.length) out.byDay = plain;
    if (ordinal.length) out.byDayOrdinal = ordinal;
  }
  if (parts.BYMONTHDAY) {
    const days = parts.BYMONTHDAY.split(",")
      .map((d) => Number(d.trim()))
      .filter((n) => Number.isInteger(n) && ((n >= 1 && n <= 31) || n === -1));
    if (days.length) out.byMonthDay = days;
  }
  if (parts.COUNT) {
    const n = Number(parts.COUNT);
    if (Number.isInteger(n) && n >= 1) out.count = n;
  }
  if (parts.UNTIL) {
    const u = parseUntil(parts.UNTIL);
    if (u) out.until = u;
  }
  return out;
}

// UNTIL in RRULE is YYYYMMDD or YYYYMMDDTHHMMSSZ; we keep the calendar day.
function parseUntil(value: string): string | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const ymd = `${m[1]}-${m[2]}-${m[3]}`;
  return isYmd(ymd) ? ymd : null;
}

export function formatRRule(parts: RRuleParts): string {
  const segs = [`FREQ=${FREQ_TO_RRULE[parts.freq]}`];
  if (parts.interval > 1) segs.push(`INTERVAL=${parts.interval}`);
  if (parts.freq === "weekly" && parts.byDay && parts.byDay.length) {
    segs.push(`BYDAY=${parts.byDay.join(",")}`);
  }
  if (parts.freq === "monthly" && parts.byDayOrdinal && parts.byDayOrdinal.length) {
    segs.push(`BYDAY=${parts.byDayOrdinal.map((e) => `${e.ordinal}${e.weekday}`).join(",")}`);
  }
  if (parts.freq === "monthly" && parts.byMonthDay && parts.byMonthDay.length) {
    segs.push(`BYMONTHDAY=${parts.byMonthDay.join(",")}`);
  }
  if (parts.count) segs.push(`COUNT=${parts.count}`);
  if (parts.until) segs.push(`UNTIL=${parts.until.replace(/-/g, "")}`);
  return segs.join(";");
}

// ---------------------------------------------------------------------------
// The stored rule: tolerant parse (the views.ts/templates.ts discipline)

export function parseRecurrence(raw: unknown): RecurrenceRule | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const parts = parseRRule(r.rrule);
  if (!parts) return null; // no valid rule ⇒ not a recurring task
  if (!isYmd(r.dtstart)) return null;

  const dedupeSorted = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter(isYmd))].sort(compareYmd);
  };

  const occurrenceMode: OccurrenceMode =
    r.occurrenceMode === "materialized" ? "materialized" : "virtual";
  const anchorMode: AnchorMode =
    r.anchorMode === "completion" ? "completion" : "fixed";

  return {
    rrule: formatRRule(parts), // normalize on read
    dtstart: r.dtstart as string,
    completeInstances: dedupeSorted(r.completeInstances),
    skippedInstances: dedupeSorted(r.skippedInstances),
    occurrenceMode,
    anchorMode,
    maintainDueOffset: r.maintainDueOffset === true || undefined,
  };
}

export function isRecurring(raw: unknown): boolean {
  return parseRecurrence(raw) !== null;
}

// Build a fresh rule from form-shaped input (the canvas editor / API).
export function makeRecurrence(input: {
  freq: Frequency;
  interval?: number;
  byDay?: Weekday[];
  byDayOrdinal?: ByDayOrdinal[];
  byMonthDay?: number[];
  count?: number;
  until?: string;
  dtstart: string;
  occurrenceMode?: OccurrenceMode;
  anchorMode?: AnchorMode;
  maintainDueOffset?: boolean;
}): RecurrenceRule {
  const parts: RRuleParts = {
    freq: input.freq,
    interval: input.interval && input.interval >= 1 ? Math.floor(input.interval) : 1,
  };
  if (input.freq === "weekly" && input.byDay?.length) parts.byDay = input.byDay;
  if (input.freq === "monthly" && input.byDayOrdinal?.length) parts.byDayOrdinal = input.byDayOrdinal;
  if (input.freq === "monthly" && input.byMonthDay?.length) parts.byMonthDay = input.byMonthDay;
  if (input.count && input.count >= 1) parts.count = Math.floor(input.count);
  if (input.until && isYmd(input.until)) parts.until = input.until;
  return {
    rrule: formatRRule(parts),
    dtstart: input.dtstart,
    completeInstances: [],
    skippedInstances: [],
    occurrenceMode: input.occurrenceMode === "materialized" ? "materialized" : "virtual",
    anchorMode: input.anchorMode === "completion" ? "completion" : "fixed",
    maintainDueOffset: input.maintainDueOffset || undefined,
  };
}

// ---------------------------------------------------------------------------
// Occurrence generation (fixed anchor). Generates from dtstart forward in
// strict date order, honoring INTERVAL / BYDAY / COUNT / UNTIL.

type EnumOpts = { from?: string; to?: string; max?: number };

export function enumerateOccurrences(
  rule: Pick<RecurrenceRule, "rrule" | "dtstart">,
  opts: EnumOpts = {}
): string[] {
  const parts = parseRRule(rule.rrule);
  if (!parts || !isYmd(rule.dtstart)) return [];
  const max = Math.min(opts.max ?? ENUMERATE_CAP, ENUMERATE_CAP);
  const out: string[] = [];
  let produced = 0; // counts against COUNT (every series occurrence)

  const emit = (ymd: string): boolean => {
    // Past UNTIL or COUNT ends the whole series.
    if (parts.until && compareYmd(ymd, parts.until) > 0) return false;
    if (parts.count && produced >= parts.count) return false;
    produced += 1;
    if (opts.to && compareYmd(ymd, opts.to) > 0) return false;
    if (!opts.from || compareYmd(ymd, opts.from) >= 0) {
      out.push(ymd);
      if (out.length >= max) return false;
    }
    return true;
  };

  if (parts.freq === "weekly" && parts.byDay && parts.byDay.length) {
    // WEEKLY+BYDAY: step whole weeks by INTERVAL from dtstart's week (WKST=MO),
    // emitting each BYDAY weekday within an active week that is >= dtstart.
    const byDaySet = new Set(parts.byDay);
    const startMonday = addDaysYmd(rule.dtstart, -weekdayIndex(rule.dtstart));
    for (let block = 0; block < ENUMERATE_CAP; block++) {
      const weekStart = addDaysYmd(startMonday, block * parts.interval * 7);
      for (let i = 0; i < 7; i++) {
        const day = addDaysYmd(weekStart, i);
        if (compareYmd(day, rule.dtstart) < 0) continue;
        if (!byDaySet.has(WEEKDAYS[i])) continue;
        if (!emit(day)) return out;
      }
    }
    return out;
  }

  // MONTHLY positional: nth-weekday(s) and/or day-of-month. Step whole months by
  // INTERVAL from dtstart's month; within each active month emit every matching
  // date (sorted, deduped) that is >= dtstart.
  if (parts.freq === "monthly" && (parts.byDayOrdinal?.length || parts.byMonthDay?.length)) {
    const [sy, sm] = rule.dtstart.split("-").map(Number);
    for (let block = 0; block < ENUMERATE_CAP; block++) {
      const total = sy * 12 + (sm - 1) + block * parts.interval;
      const year = Math.floor(total / 12);
      const month1 = (total % 12) + 1;
      const dates = new Set<string>();
      for (const e of parts.byDayOrdinal ?? []) {
        const d = nthWeekdayOfMonth(year, month1, e.weekday, e.ordinal);
        if (d) dates.add(d);
      }
      for (const md of parts.byMonthDay ?? []) {
        const d = monthDayOf(year, month1, md);
        if (d) dates.add(d);
      }
      for (const ymd of [...dates].sort(compareYmd)) {
        if (compareYmd(ymd, rule.dtstart) < 0) continue;
        if (!emit(ymd)) return out;
      }
    }
    return out;
  }

  // DAILY / WEEKLY(no byday) / MONTHLY / YEARLY: one occurrence per step.
  for (let k = 0; k < ENUMERATE_CAP; k++) {
    let ymd: string;
    switch (parts.freq) {
      case "daily":
        ymd = addDaysYmd(rule.dtstart, k * parts.interval);
        break;
      case "weekly":
        ymd = addDaysYmd(rule.dtstart, k * parts.interval * 7);
        break;
      case "monthly":
        ymd = addMonthsYmd(rule.dtstart, k * parts.interval);
        break;
      case "yearly":
        ymd = addYearsYmd(rule.dtstart, k * parts.interval);
        break;
    }
    if (!emit(ymd)) return out;
  }
  return out;
}

function weekdayIndex(ymd: string): number {
  return WEEKDAYS.indexOf(weekdayOf(ymd));
}

// First series occurrence on/after `ref` (ignores the completion log).
export function nextOccurrenceOnOrAfter(
  rule: Pick<RecurrenceRule, "rrule" | "dtstart">,
  ref: string
): string | null {
  const found = enumerateOccurrences(rule, { from: ref, max: 1 });
  return found[0] ?? null;
}

// First series occurrence on/after `ref` that is NOT completed or skipped —
// the concrete date `scheduled` should point at. null = series exhausted.
export function nextUncompletedOnOrAfter(
  rule: RecurrenceRule,
  ref: string
): string | null {
  const done = new Set([...rule.completeInstances, ...rule.skippedInstances]);
  // Enumerate a bounded window from ref; skip logged dates.
  const occ = enumerateOccurrences(rule, { from: ref, max: ENUMERATE_CAP });
  for (const ymd of occ) {
    if (!done.has(ymd)) return ymd;
  }
  return null;
}

// completion-anchor step: the next date is computed from when you finished,
// not from a fixed calendar.
function advanceByInterval(ymd: string, parts: RRuleParts): string {
  switch (parts.freq) {
    case "daily":
      return addDaysYmd(ymd, parts.interval);
    case "weekly":
      return addDaysYmd(ymd, parts.interval * 7);
    case "monthly":
      return addMonthsYmd(ymd, parts.interval);
    case "yearly":
      return addYearsYmd(ymd, parts.interval);
  }
}

// ---------------------------------------------------------------------------
// State transitions (pure): completing / skipping an occurrence.

export type AdvanceResult = {
  rule: RecurrenceRule; // the updated rule (new log)
  next: string | null; // the new scheduled date, or null if the series ended
  ended: boolean; // true when no next occurrence remains
};

// Complete the occurrence on `occurrenceDate`. `completedOn` (default =
// occurrenceDate) drives completion-anchored recurrence ("3 days after I
// actually did it"). Stamps the log and computes the next scheduled date.
export function completeOccurrence(
  rule: RecurrenceRule,
  occurrenceDate: string,
  completedOn: string = occurrenceDate
): AdvanceResult {
  const parts = parseRRule(rule.rrule)!;
  const completeInstances = [
    ...new Set([...rule.completeInstances, occurrenceDate]),
  ].sort(compareYmd);
  // A completed date is no longer "skipped".
  const skippedInstances = rule.skippedInstances.filter((d) => d !== occurrenceDate);
  const updated: RecurrenceRule = { ...rule, completeInstances, skippedInstances };

  let next: string | null;
  if (rule.anchorMode === "completion") {
    const candidate = advanceByInterval(completedOn, parts);
    next = withinSeries(parts, candidate, completeInstances.length) ? candidate : null;
  } else {
    next = nextUncompletedOnOrAfter(updated, addDaysYmd(occurrenceDate, 1));
  }
  return { rule: updated, next, ended: next === null };
}

// Skip the occurrence on `occurrenceDate` (distinct from done and from missed).
export function skipOccurrence(
  rule: RecurrenceRule,
  occurrenceDate: string
): AdvanceResult {
  const parts = parseRRule(rule.rrule)!;
  const skippedInstances = [
    ...new Set([...rule.skippedInstances, occurrenceDate]),
  ].sort(compareYmd);
  const completeInstances = rule.completeInstances.filter((d) => d !== occurrenceDate);
  const updated: RecurrenceRule = { ...rule, skippedInstances, completeInstances };

  let next: string | null;
  if (rule.anchorMode === "completion") {
    const candidate = advanceByInterval(occurrenceDate, parts);
    // A skip doesn't count against COUNT (only completions do).
    next = withinSeries(parts, candidate, completeInstances.length) ? candidate : null;
  } else {
    next = nextUncompletedOnOrAfter(updated, addDaysYmd(occurrenceDate, 1));
  }
  return { rule: updated, next, ended: next === null };
}

// For completion-anchored rules: is `candidate` still inside the series bounds?
function withinSeries(
  parts: RRuleParts,
  candidate: string,
  completedCount: number
): boolean {
  if (parts.until && compareYmd(candidate, parts.until) > 0) return false;
  if (parts.count && completedCount >= parts.count) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Direct completion-log edits (the completions calendar — S3, ADR-083). The
// calendar lets the user tick/untick ARBITRARY occurrence dates in any order;
// these are pure log mutations that DON'T compute a next date (the service
// recomputes `scheduled` after the edit, forward-looking, ADR-076 §8). Distinct
// from completeOccurrence/skipOccurrence, which are the "I just did the current
// occurrence" gesture and branch on the anchor mode.

// Is `date` an occurrence of this rule (inside the RRULE calendar projection +
// any COUNT/UNTIL bound)? Used to validate a calendar toggle/carve and to paint
// occurrence cells. Enumerates from dtstart up to `date` (bounded by the cap).
export function isOccurrence(
  rule: Pick<RecurrenceRule, "rrule" | "dtstart">,
  date: string
): boolean {
  if (!isYmd(date)) return false;
  return enumerateOccurrences(rule, { from: date, to: date, max: 1 }).length > 0;
}

// Toggle `date` in the completion log: complete it if it isn't, un-complete it if
// it is. Completing a date clears any "skipped" stamp on it (a date is done OR
// skipped OR neither, never both).
export function toggleCompleteInstance(
  rule: RecurrenceRule,
  date: string
): RecurrenceRule {
  const has = rule.completeInstances.includes(date);
  const completeInstances = has
    ? rule.completeInstances.filter((d) => d !== date)
    : [...new Set([...rule.completeInstances, date])].sort(compareYmd);
  const skippedInstances = has
    ? rule.skippedInstances
    : rule.skippedInstances.filter((d) => d !== date);
  return { ...rule, completeInstances, skippedInstances };
}

// Mark `date` skipped (and no longer complete) — used when an occurrence is
// carved out into its own detached item (the series stops counting that date).
export function addSkippedInstance(
  rule: RecurrenceRule,
  date: string
): RecurrenceRule {
  const skippedInstances = [...new Set([...rule.skippedInstances, date])].sort(
    compareYmd
  );
  const completeInstances = rule.completeInstances.filter((d) => d !== date);
  return { ...rule, skippedInstances, completeInstances };
}

export type InstanceState = "complete" | "skipped" | "none";

// The logged state of one occurrence date (the calendar cell painter).
export function instanceState(
  rule: Pick<RecurrenceRule, "completeInstances" | "skippedInstances">,
  date: string
): InstanceState {
  if (rule.completeInstances.includes(date)) return "complete";
  if (rule.skippedInstances.includes(date)) return "skipped";
  return "none";
}

// ---------------------------------------------------------------------------
// Human-readable description (for the canvas chip + the ICS SUMMARY suffix).

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

const WEEKDAY_FULL: Record<Weekday, string> = {
  MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday",
  FR: "Friday", SA: "Saturday", SU: "Sunday",
};

const ORDINAL_WORD: Record<number, string> = {
  [-1]: "last", 1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
};

// 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", -1 → "last day".
function dayOrdinal(n: number): string {
  if (n === -1) return "last day";
  const s = n % 100;
  const suffix = s >= 11 && s <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

// The "X" in "on the X" for a monthly-positional rule: "first Sunday",
// "first & second Thursday", "3rd", or a combination.
function describeMonthlyOn(parts: RRuleParts): string {
  const segs: string[] = [];
  const ord = parts.byDayOrdinal ?? [];
  if (ord.length) {
    const sameWeekday = ord.every((e) => e.weekday === ord[0].weekday);
    if (sameWeekday) {
      const ords = ord.map((e) => ORDINAL_WORD[e.ordinal] ?? `${e.ordinal}`).join(" & ");
      segs.push(`${ords} ${WEEKDAY_FULL[ord[0].weekday]}`);
    } else {
      for (const e of ord) segs.push(`${ORDINAL_WORD[e.ordinal] ?? e.ordinal} ${WEEKDAY_FULL[e.weekday]}`);
    }
  }
  for (const md of parts.byMonthDay ?? []) segs.push(dayOrdinal(md));
  return segs.join(", ");
}

export function describeRule(rule: RecurrenceRule | RRuleParts): string {
  const parts = "rrule" in rule ? parseRRule(rule.rrule) : rule;
  if (!parts) return "Does not repeat";
  const n = parts.interval;
  const unit: Record<Frequency, string> = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  };
  const adverb: Record<Frequency, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
  };
  let base: string;
  if (parts.freq === "weekly" && parts.byDay?.length) {
    const days = parts.byDay.map((d) => WEEKDAY_LABELS[d]).join(", ");
    base = n === 1 ? `Weekly on ${days}` : `Every ${n} weeks on ${days}`;
  } else if (parts.freq === "monthly" && (parts.byDayOrdinal?.length || parts.byMonthDay?.length)) {
    const on = describeMonthlyOn(parts);
    base = n === 1 ? `Monthly on the ${on}` : `Every ${n} months on the ${on}`;
  } else {
    base = n === 1 ? adverb[parts.freq] : `Every ${n} ${unit[parts.freq]}s`;
  }
  if ("anchorMode" in rule && rule.anchorMode === "completion") {
    base += " after completion";
  }
  if (parts.count) base += `, ${parts.count}×`;
  else if (parts.until) base += `, until ${parts.until}`;
  return base;
}
