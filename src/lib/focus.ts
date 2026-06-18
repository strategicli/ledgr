// The daily focus layer ("Top 3" / in-focus) marker (T3, ADR-073). A task's
// focus is a day-stamped marker in properties.focus = { date: "YYYY-MM-DD",
// order? }: it means "one of the vital few I intend to do TODAY," distinct from
// due (the deadline) and scheduled (the plan). Day-stamped so it auto-clears
// overnight — no silent carryover; a fresh morning re-pick (explorations/
// task-focus-layer.md). No new column (Principle 2/8): owner data over the task.
//
// PURE + client-safe (no DB), so the star affordance and the Today zone share
// one reader.
import { isYmd } from "@/lib/recurrence";

// A gentle nudge, not a hard wall: the methodology says 1-3, but a heavy day
// shouldn't be blocked (explorations/task-focus-layer.md fork 2 → soft).
export const FOCUS_SOFT_CAP = 3;

export type FocusMarker = { date: string; order?: number };

export function parseFocus(raw: unknown): FocusMarker | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isYmd(r.date)) return null;
  const order = typeof r.order === "number" && Number.isFinite(r.order) ? r.order : undefined;
  return order === undefined ? { date: r.date as string } : { date: r.date as string, order };
}

// The focus marker on an item's properties, or null.
export function focusOf(properties: unknown): FocusMarker | null {
  if (typeof properties !== "object" || properties === null) return null;
  return parseFocus((properties as Record<string, unknown>).focus);
}

// Is this item focused for the given day?
export function isFocusedOn(properties: unknown, ymd: string): boolean {
  return focusOf(properties)?.date === ymd;
}

// Sort key for the focus zone: the marker's order, else a large number so
// unordered markers sort after ordered ones (stable by a secondary key).
export function focusOrder(properties: unknown): number {
  return focusOf(properties)?.order ?? Number.MAX_SAFE_INTEGER;
}
