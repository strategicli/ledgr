// K1 verification (mobile kanban drag-and-drop): the PURE touch-drag helpers in
// board-touch-drag.ts — the long-press move-cancel threshold (scroll vs. hold)
// and the column-under-finger hit test (direct hit + nearest-column fallback).
// The effectful hook (useBoardTouchDrag) and the BoardDnd wiring are touch
// gesture behavior, verified in-browser (DevTools touch emulation + a real
// phone), not here. Run: npx tsx scripts/verify-touch-drag.mts
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_SPEED,
  columnAtPoint,
  edgeAutoScrollVelocity,
  exceedsMoveThreshold,
  LONG_PRESS_MS,
  MOVE_CANCEL_PX,
  type ColumnRect,
} from "../src/lib/board-touch-drag";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function eq<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`,
  );
  if (!ok) failures += 1;
}

console.log("\n# constants (sane long-press feel)");
check("long-press hold 250–600ms", LONG_PRESS_MS >= 250 && LONG_PRESS_MS <= 600, `${LONG_PRESS_MS}ms`);
check("move threshold 4–16px", MOVE_CANCEL_PX >= 4 && MOVE_CANCEL_PX <= 16, `${MOVE_CANCEL_PX}px`);

console.log("\n# exceedsMoveThreshold (origin 100,100; default threshold 8px)");
const o = { x: 100, y: 100 };
check("still finger holds (no cancel)", exceedsMoveThreshold(o, { x: 100, y: 100 }) === false);
check("3px jitter holds", exceedsMoveThreshold(o, { x: 102, y: 102 }) === false);
check("exactly 8px holds (strict >)", exceedsMoveThreshold(o, { x: 108, y: 100 }) === false);
check("9px horizontal cancels", exceedsMoveThreshold(o, { x: 109, y: 100 }) === true);
check("vertical scroll cancels", exceedsMoveThreshold(o, { x: 100, y: 120 }) === true);
check("diagonal past radius cancels (~8.49px)", exceedsMoveThreshold(o, { x: 106, y: 106 }) === true);
check("custom larger threshold holds", exceedsMoveThreshold(o, { x: 120, y: 100 }, 30) === false);

console.log("\n# columnAtPoint (3 cols: todo[0–100] gap doing[110–210] gap done[220–320])");
const cols: ColumnRect[] = [
  { col: "todo", left: 0, right: 100 },
  { col: "doing", left: 110, right: 210 },
  { col: "done", left: 220, right: 320 },
];
eq("direct hit middle", columnAtPoint(cols, 150), "doing");
eq("direct hit first", columnAtPoint(cols, 50), "todo");
eq("left edge inclusive", columnAtPoint(cols, 0), "todo");
eq("right edge inclusive", columnAtPoint(cols, 100), "todo");
eq("gap nearer todo → todo", columnAtPoint(cols, 104), "todo");
eq("gap nearer doing → doing", columnAtPoint(cols, 107), "doing");
eq("far left of all → first", columnAtPoint(cols, -500), "todo");
eq("far right of all → last", columnAtPoint(cols, 9999), "done");
eq("no columns → null", columnAtPoint([], 100), null);
eq("single column always wins", columnAtPoint([{ col: "only", left: 0, right: 10 }], 9999), "only");

console.log(`\n# edgeAutoScrollVelocity (edge ${AUTO_SCROLL_EDGE_PX}px, max ${AUTO_SCROLL_MAX_SPEED})`);
eq("outside the zone → no scroll", edgeAutoScrollVelocity(AUTO_SCROLL_EDGE_PX), 0);
eq("far inside → no scroll", edgeAutoScrollVelocity(500), 0);
eq("right at the edge → max speed", edgeAutoScrollVelocity(0), AUTO_SCROLL_MAX_SPEED);
eq("past the edge (negative) → clamped to max", edgeAutoScrollVelocity(-40), AUTO_SCROLL_MAX_SPEED);
eq("halfway in → ~half speed", edgeAutoScrollVelocity(28), Math.ceil(0.5 * AUTO_SCROLL_MAX_SPEED));
check("closer ramps faster", edgeAutoScrollVelocity(10) > edgeAutoScrollVelocity(40));
check("inside the zone always scrolls ≥1px", edgeAutoScrollVelocity(AUTO_SCROLL_EDGE_PX - 1) >= 1);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
