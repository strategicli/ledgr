// Shared "when" formatting for the event lenses (Calendar feed + Timeline).
// A meeting time shows weekday + month/day + time in the app timezone; drop the
// year when it's the current year, add it otherwise. Pure — safe on server and
// client.
import { APP_TIMEZONE } from "@/lib/today";

const sameYearFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});
const otherYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});
const yearFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: APP_TIMEZONE,
});

export function formatWhen(at: Date, now: Date): string {
  return yearFmt.format(at) === yearFmt.format(now)
    ? sameYearFmt.format(at)
    : otherYearFmt.format(at);
}
