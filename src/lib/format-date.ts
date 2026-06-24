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
