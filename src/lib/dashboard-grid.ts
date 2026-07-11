// Pure geometry for the dashboard grid — no React, no react-grid-layout import,
// so it can be shared by the RGL grid (RglInner) AND the load skeleton
// (DashboardGridLayout) without pulling RGL's client bundle onto pages that only
// need the height estimate. Keep these constants the single source of truth: the
// grid renders from them and the skeleton reserves space from them, so they must
// stay in lockstep or the load would jump.
import {
  effectiveAppearance,
  type GridBreakpoint,
  type WidgetData,
} from "./dashboard-widgets";

// A short row height gives fine vertical control (a text header can sit ~40px
// tall). Margin is [x, y] between cells; containerPadding is [0, 0].
export const ROW_HEIGHT = 40;
export const GRID_MARGIN: [number, number] = [16, 12];

type Kind = WidgetData["widget"]["kind"];

// Default cell height (in rows) by kind: a heading is one short row; a count a
// couple; an embed/list taller; a container the tallest. Stat defaults to 2 rows
// (ui-refresh S7a) but stays fully resizable, so this only sets the default a
// fresh/un-resized stat opens at.
export function defaultH(kind: Kind) {
  if (kind === "text") return 1;
  if (kind === "action") return 2;
  if (kind === "stat") return 2;
  if (kind === "embed") return 6;
  if (kind === "image") return 5;
  if (kind === "container") return 10;
  return 8;
}

// Default placement when a widget has no stored cell for a breakpoint: two per
// row on lg/md, single column on sm (mobile is always a vertical stack).
export function defaultCell(bp: GridBreakpoint, i: number, kind: Kind) {
  const h = defaultH(kind);
  if (bp === "sm") return { x: 0, y: i * 8, w: 1, h };
  if (bp === "md") return { x: (i % 2) * 3, y: Math.floor(i / 2) * 8, w: 3, h };
  return { x: (i % 2) * 6, y: Math.floor(i / 2) * 8, w: 6, h };
}

// Estimate the grid's pixel height at a breakpoint (default lg = desktop), so the
// load skeleton can reserve that space and widgets don't pile up diagonally
// before RGL measures its width and snaps them into place. Mirrors RGL's own
// containerHeight math (bottom rows × rowHeight + gaps between them), and folds
// collapsed (view-mode) widgets to one row to match what actually renders. The
// reservation is dropped the moment RGL reports its first real layout, so a rough
// estimate only has to prevent the load jump — exactness isn't required.
export function estimateGridHeight(
  widgets: WidgetData[],
  bp: GridBreakpoint = "lg"
): number {
  let bottom = 0;
  widgets.forEach((wd, i) => {
    const base = wd.widget.layout[bp] ?? defaultCell(bp, i, wd.widget.kind);
    const h = effectiveAppearance(wd.widget).collapsed ? 1 : base.h;
    bottom = Math.max(bottom, base.y + h);
  });
  if (bottom <= 0) return 0;
  return bottom * ROW_HEIGHT + (bottom - 1) * GRID_MARGIN[1];
}
