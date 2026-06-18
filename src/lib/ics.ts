// Published ICS task feed (T4, ADR-079). A read-only RFC-5545 VCALENDAR of the
// owner's open, dated tasks so any calendar app (Outlook / Apple / Google) can
// subscribe (webcal://) and fire its own reminders — Sunday-proof (the route
// caches it), standards-based, no new push infra (Principle 4/5/8).
//
// PURE + node/edge-safe: no DB, no clock (the route passes `dtstamp`), so it's
// fully testable. A task is an all-day VEVENT on its effective plan date, UNLESS
// it carries a scheduled start time (Stage A time-blocking) — then it's a timed
// block (DTSTART/DTEND with a floating wall-clock time, no zone). A recurring
// task emits the stored RRULE verbatim (this is exactly why the recurrence rule
// is stored standards-shaped, ADR-076) so the calendar expands every occurrence
// and reminds for each — timed occurrences when the series has a start time. A
// default VALARM rides each event (9am for all-day, at-start for a timed block),
// overridable per task by a reminder lead time.

export type IcsTask = {
  id: string;
  title: string;
  // The event's calendar day (YYYY-MM-DD): the task's scheduled day if set,
  // else its due day. For a recurring task this is the recurrence anchor.
  date: string;
  // Optional scheduled time-of-day (Stage A time-blocking): a floating local
  // "HH:MM" start. Present → the event is a timed block (DTSTART/DTEND carry the
  // time) instead of all-day; absent → all-day exactly as before. Floating means
  // no zone suffix: it renders at that clock time wherever the calendar shows it.
  startTime?: string | null;
  // The block length in minutes; paired with startTime. Defaults to 60 when a
  // start is present without one.
  durationMinutes?: number | null;
  // The stored RRULE body (no DTSTART) for a recurring task; null/undefined for
  // a one-off. Emitted verbatim so the calendar expands occurrences natively.
  rrule?: string | null;
  // A link back to the item in Ledgr (absolute URL), shown in the event.
  url?: string;
  // Reminder lead time in minutes before the event; when set, replaces the
  // default alarm. 0 = at the event start (midnight for all-day, the block start
  // for a timed task).
  reminderMinutes?: number | null;
  // Excluded occurrence dates (YYYY-MM-DD) for a recurring task — its completed
  // and skipped/carved instances (S6, ADR-086). Emitted as RFC-5545 EXDATE so a
  // subscribing calendar drops those days (no stale reminder for work done).
  exdates?: string[];
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad2 = (n: number) => String(n).padStart(2, "0");

// A floating (zoneless) RFC-5545 DATE-TIME stamp for `ymd` at `minutes` past its
// midnight, rolling into later days when minutes exceed 1440 (a block crossing
// midnight). Date.UTC is used purely for calendar arithmetic; the emitted value
// has no Z/TZID, so it stays floating local.
function floatingStamp(ymd: string, minutes: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dayOffset = Math.floor(minutes / 1440);
  const within = ((minutes % 1440) + 1440) % 1440;
  const dt = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(
    Math.floor(within / 60)
  )}${pad2(within % 60)}00`;
}

// A valid floating start in minutes-since-midnight, or null when the task is
// all-day. Self-contained (mirrors lib/scheduled-time.ts) to keep this RFC
// builder dependency-free.
function startMinutesOf(task: IcsTask): number | null {
  if (!task.startTime || !HHMM.test(task.startTime)) return null;
  const [h, m] = task.startTime.split(":").map(Number);
  return h * 60 + m;
}

// RFC-5545 TEXT escaping: backslash, semicolon, comma, and newlines.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold a content line to <=75 octets per RFC 5545, continuation lines start
// with a single space. ASCII-oriented (our content is plain), which is fine for
// titles; folds on character count as a safe proxy.
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, "");
}

// The day after `ymd` (for an all-day DTEND, which is exclusive), via UTC so it
// never shifts with a zone.
function nextDayCompact(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function alarm(task: IcsTask, timed: boolean): string[] {
  // Per-task lead time overrides the default; otherwise an all-day task reminds
  // at 9am (PT9H after the midnight start), while a timed block reminds at its
  // start (PT0M). Either way the offset is relative to DTSTART, so a set lead
  // time fires that many minutes before the event begins.
  const trigger =
    task.reminderMinutes != null
      ? task.reminderMinutes <= 0
        ? "TRIGGER:PT0M"
        : `TRIGGER:-PT${Math.round(task.reminderMinutes)}M`
      : timed
        ? "TRIGGER:PT0M"
        : "TRIGGER:PT9H";
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(task.title || "Task")}`,
    trigger,
    "END:VALARM",
  ];
}

function vevent(task: IcsTask, dtstamp: string): string[] {
  const start = startMinutesOf(task);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${task.id}@ledgr`,
    `DTSTAMP:${dtstamp}`,
  ];
  if (start != null) {
    // Timed block (Stage A): floating DATE-TIME start + end = start + duration
    // (default 60m), rolling past midnight if the block does.
    const dur =
      task.durationMinutes != null && task.durationMinutes > 0
        ? Math.round(task.durationMinutes)
        : 60;
    lines.push(`DTSTART:${floatingStamp(task.date, start)}`);
    lines.push(`DTEND:${floatingStamp(task.date, start + dur)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ymdCompact(task.date)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDayCompact(task.date)}`);
  }
  lines.push(`SUMMARY:${escapeText(task.title || "Untitled task")}`);
  if (task.rrule) lines.push(`RRULE:${task.rrule}`);
  // EXDATE only with an RRULE: drop completed/skipped occurrences from the
  // expansion. Its value type must match DTSTART — DATE-TIME (at the block start)
  // for a timed series, plain DATE for an all-day one (RFC 5545).
  if (task.rrule && task.exdates && task.exdates.length) {
    if (start != null) {
      lines.push(`EXDATE:${task.exdates.map((d) => floatingStamp(d, start)).join(",")}`);
    } else {
      lines.push(`EXDATE;VALUE=DATE:${task.exdates.map(ymdCompact).join(",")}`);
    }
  }
  if (task.url) lines.push(`URL:${escapeText(task.url)}`);
  lines.push(...alarm(task, start != null));
  lines.push("END:VEVENT");
  return lines;
}

export function buildTaskCalendar(
  tasks: IcsTask[],
  opts: { name?: string; dtstamp: string }
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ledgr//Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name ?? "Ledgr Tasks")}`,
    // Hint subscribers to refresh ~hourly (Outlook/Apple honor this loosely).
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const t of tasks) lines.push(...vevent(t, opts.dtstamp));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
