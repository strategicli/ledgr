// Pure geometry for the Planner time-grid (ADR-131): mapping a floating time
// block (start minutes + duration) to/from pixel offsets in a day column whose
// rows are `slotMinutes` tall at `slotPx` each, starting at `workStartHour`. No
// DOM, no React — node-testable; the effectful drag/resize wiring lives in the
// PlannerTimeGrid component. Pairs with scheduled-time.ts (the stored shape).

// How many slot rows a work-hours window spans (e.g. 7→19 at 30-min = 24 rows).
export function slotCount(workStartHour: number, workEndHour: number, slotMinutes: number): number {
  return Math.max(1, Math.round(((workEndHour - workStartHour) * 60) / slotMinutes));
}

// The "HH:MM" start of slot row `index` (0-based) in a window from workStartHour.
export function slotStartHhmm(index: number, workStartHour: number, slotMinutes: number): string {
  const total = workStartHour * 60 + index * slotMinutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Top offset (px) of a block whose start is `startMin` minutes-since-midnight,
// in a column anchored at `workStartHour`. May be negative if the block starts
// before the visible window (the component clamps); kept raw here for testing.
export function blockTopPx(
  startMin: number,
  workStartHour: number,
  slotMinutes: number,
  slotPx: number,
): number {
  return ((startMin - workStartHour * 60) / slotMinutes) * slotPx;
}

// Height (px) of a block of `durationMin`, never thinner than one slot so a
// short block stays grabbable.
export function blockHeightPx(durationMin: number, slotMinutes: number, slotPx: number): number {
  return Math.max(slotPx, (durationMin / slotMinutes) * slotPx);
}

// Resize: a dragged block height (px) → a duration snapped to whole slots, at
// least one slot.
export function durationFromResizePx(heightPx: number, slotMinutes: number, slotPx: number): number {
  const slots = Math.max(1, Math.round(heightPx / slotPx));
  return slots * slotMinutes;
}
