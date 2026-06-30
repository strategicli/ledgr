// Read-only calendar overlay for the Planner: show what's already on the
// calendar (synced Microsoft events) behind the schedulable tasks, so work can
// be planned around it. Pure types + date math only (no db import) so the
// client grids can share the shape and the pages can compute the fetch window.

// A synced calendar event reduced to what the overlay needs, with its day +
// start already resolved to the app timezone so the client grids can bucket and
// place it without doing any timezone math. Events have real instants;
// resolving them to a calendar day + wall-clock here keeps the grids simple.
export type OverlayEvent = {
  id: string;
  title: string;
  ymd: string; // app-tz calendar day, "YYYY-MM-DD"
  start: string | null; // app-tz start, "HH:MM" (24h); null = all-day
  durationMinutes: number;
  location: string | null;
};

// The fetch window for the overlay: a today-anchored band wide enough for the
// time-grid's horizontal scroll, widened to include a navigated month so the
// month grid's overlay is populated when paging forward/back. Events only exist
// as far as calendar sync reached (~2 weeks ahead), so over-asking is cheap and
// the query is index-backed.
export function overlayWindow(
  month?: string,
  now = new Date()
): { start: Date; end: Date } {
  const start = new Date(now);
  start.setDate(start.getDate() - 2);
  const end = new Date(now);
  end.setDate(end.getDate() + 45);
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const mStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const mEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));
    return {
      start: mStart < start ? mStart : start,
      end: mEnd > end ? mEnd : end,
    };
  }
  return { start, end };
}
