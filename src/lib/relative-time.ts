// "2 minutes ago"-style rendering, shared by the sync surfaces (the nav pill,
// the Synced devices table, the /build/updates Sync section). Same shape as
// the notification list's local helper; extracted rather than duplicated a
// third time. Pure and environment-free, so server and client both use it.
const rel = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  const mins = Math.round(diffSec / 60);
  if (Math.abs(mins) < 60) return rel.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rel.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rel.format(days, "day");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
