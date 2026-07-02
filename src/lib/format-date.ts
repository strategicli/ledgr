// Compact calendar-day labels for the task rail's collapsed property rows
// ("Thu, Jun 25"). Scheduled/due are stored as UTC-midnight calendar days
// (ADR-008), so we format from the YMD parts in UTC — never local Date
// rendering, which would drift the day across timezones. Pure + dependency-free.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Accepts an ISO instant or a YYYY-MM-DD string (we only ever read the date
// part). Returns null for empty/garbage so callers can show their "add" state.
export function formatDayLabel(
  value: string | null | undefined,
  opts?: { weekday?: boolean; year?: boolean }
): string | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const wd = opts?.weekday ? `${WEEKDAYS[dow]}, ` : "";
  const yr = opts?.year ? `, ${y}` : "";
  return `${wd}${MONTHS[m - 1]} ${d}${yr}`;
}

// True when `value`'s calendar day is strictly before `today`. Both are read as
// their date part only (ISO instant or YYYY-MM-DD); ISO 8601 date strings sort
// lexically the same as chronologically, so a plain string compare is correct
// and timezone-free — matching how scheduled/due are stored (UTC midnight) and
// how `today` is the app-timezone YMD. A date equal to today is NOT overdue.
export function isOverdueYmd(
  value: string | null | undefined,
  today: string | null | undefined
): boolean {
  if (!value || !today) return false;
  return value.slice(0, 10) < today.slice(0, 10);
}
