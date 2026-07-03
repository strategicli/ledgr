// Shared count formatting (ui-refresh S1). One place that decides how a numeric
// badge/count renders, so nav bubbles, dashboard stat cards, and "recently
// touched" counts all agree instead of each re-implementing the `> 99 ? "99+"`
// check (the audit found a raw `8940` badge). `cap` is configurable for the rare
// surface that wants a higher ceiling.
export function badgeCount(n: number, cap = 99): string {
  if (!Number.isFinite(n)) return "";
  const v = Math.max(0, Math.floor(n));
  return v > cap ? `${cap}+` : String(v);
}
