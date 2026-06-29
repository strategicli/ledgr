// Pure geometry + decision helpers for the board's touch long-press drag
// (BoardDnd's useBoardTouchDrag hook). No DOM, no React — node-testable; the
// effectful timer/listener wiring lives in the hook. Desktop keeps native
// HTML5 mouse drag; this is the isolated touch path (Principle 5, no DnD dep).

// Hold this long (ms) without moving to lift a card into a drag. ~400ms is the
// usual long-press feel (Trello/Notion): long enough not to fire on a tap or
// the start of a scroll, short enough not to feel stuck.
export const LONG_PRESS_MS = 400;

// Finger travel (px) before the long-press fires that we read as a scroll/swipe
// (or an imprecise tap) and bail on, letting the browser scroll natively.
export const MOVE_CANCEL_PX = 8;

export type Point = { x: number; y: number };

// A board column's horizontal span in viewport coordinates. Columns are
// full-height, so which column a finger is over is purely an x question.
export type ColumnRect = { col: string; left: number; right: number };

// Has the finger moved far enough from the press origin to abandon the
// long-press? (Compared squared to skip the sqrt.)
export function exceedsMoveThreshold(
  start: Point,
  current: Point,
  threshold = MOVE_CANCEL_PX,
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy > threshold * threshold;
}

// Which column is under the pointer? Prefer a direct hit; otherwise the nearest
// column by horizontal distance, so a drag that strays into a gap or just past
// the last column still targets the closest one rather than dropping the
// target. Returns null only when there are no columns.
export function columnAtPoint(rects: ColumnRect[], x: number): string | null {
  for (const r of rects) {
    if (x >= r.left && x <= r.right) return r.col;
  }
  let best: string | null = null;
  let bestDist = Infinity;
  for (const r of rects) {
    const dist = x < r.left ? r.left - x : x - r.right;
    if (dist < bestDist) {
      bestDist = dist;
      best = r.col;
    }
  }
  return best;
}

// A planner day-cell's full rectangle in viewport coordinates. Unlike a board
// column (full-height, an x-only question), a month grid is 2D, so the planner's
// touch hit-test needs both axes. A sentinel `day` (e.g. "__none__" for the
// Unscheduled rail) rides through unchanged.
export type CellRect = { day: string; left: number; right: number; top: number; bottom: number };

// Which day cell is under the pointer? Prefer a direct hit; otherwise the
// nearest cell by squared edge-distance, so a drop that lands in a gutter or
// just past the grid still targets the closest day rather than dropping the
// move. Returns null only when there are no cells. (The 2D sibling of
// columnAtPoint — the board path is unchanged.)
export function cellAtPoint(rects: CellRect[], x: number, y: number): string | null {
  for (const r of rects) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return r.day;
  }
  let best: string | null = null;
  let bestDist = Infinity;
  for (const r of rects) {
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = r.day;
    }
  }
  return best;
}

// How close (px) to a scroll edge the finger must be while dragging before the
// board (horizontal) / page (vertical) starts auto-scrolling, and the fastest
// it scrolls.
export const AUTO_SCROLL_EDGE_PX = 56;
export const AUTO_SCROLL_MAX_SPEED = 18;

// Auto-scroll speed (px/frame) when the finger is `distance` px from a scroll
// edge: zero outside the trigger zone, ramping linearly to maxSpeed at the edge
// (and staying at maxSpeed if the finger is past it). The ramp is why an
// off-screen column on a narrow phone is reachable: hold near the edge and the
// columns slide toward you.
export function edgeAutoScrollVelocity(
  distance: number,
  edge = AUTO_SCROLL_EDGE_PX,
  maxSpeed = AUTO_SCROLL_MAX_SPEED,
): number {
  const t = Math.max(0, Math.min(1, 1 - distance / edge));
  return Math.ceil(t * maxSpeed);
}
