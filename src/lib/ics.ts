// Published ICS task feed (T4, ADR-079). A read-only RFC-5545 VCALENDAR of the
// owner's open, dated tasks so any calendar app (Outlook / Apple / Google) can
// subscribe (webcal://) and fire its own reminders — Sunday-proof (the route
// caches it), standards-based, no new push infra (Principle 4/5/8).
//
// PURE + node/edge-safe: no DB, no clock (the route passes `dtstamp`), so it's
// fully testable. Tasks are all-day VEVENTs on their effective plan date; a
// recurring task emits the stored RRULE verbatim (this is exactly why the
// recurrence rule is stored standards-shaped, ADR-076) so the calendar expands
// every occurrence and reminds for each. A default morning VALARM rides each
// event, overridable per task by a reminder lead time.

export type IcsTask = {
  id: string;
  title: string;
  // The event's calendar day (YYYY-MM-DD): the task's scheduled day if set,
  // else its due day. For a recurring task this is the recurrence anchor.
  date: string;
  // The stored RRULE body (no DTSTART) for a recurring task; null/undefined for
  // a one-off. Emitted verbatim so the calendar expands occurrences natively.
  rrule?: string | null;
  // A link back to the item in Ledgr (absolute URL), shown in the event.
  url?: string;
  // Reminder lead time in minutes before the event; when set, replaces the
  // default morning alarm. 0 = at the event start (midnight of the day).
  reminderMinutes?: number | null;
};

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

function alarm(task: IcsTask): string[] {
  // Per-task lead time overrides the default; otherwise remind at 9am on the day
  // (PT9H after the midnight all-day start).
  const trigger =
    task.reminderMinutes != null
      ? task.reminderMinutes <= 0
        ? "TRIGGER:PT0M"
        : `TRIGGER:-PT${Math.round(task.reminderMinutes)}M`
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
  const lines = [
    "BEGIN:VEVENT",
    `UID:${task.id}@ledgr`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${ymdCompact(task.date)}`,
    `DTEND;VALUE=DATE:${nextDayCompact(task.date)}`,
    `SUMMARY:${escapeText(task.title || "Untitled task")}`,
  ];
  if (task.rrule) lines.push(`RRULE:${task.rrule}`);
  if (task.url) lines.push(`URL:${escapeText(task.url)}`);
  lines.push(...alarm(task));
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
