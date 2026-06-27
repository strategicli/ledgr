// The react-grid-layout grid itself (client-only; loaded via next/dynamic with
// ssr:false from DashboardGridLayout, because RGL measures window width on mount
// and can't server-render). Builds a per-breakpoint layout from each widget's
// stored cell (falling back to a sensible default placement), and reports the
// whole Layouts object up on every drag/resize. Drag is gated to a handle so
// links and scrolling inside a widget never move it.
"use client";

import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  effectiveAppearance,
  GRID_BREAKPOINTS,
  type GridBreakpoint,
  type WidgetAppearance,
  type WidgetData,
  type WidgetSettings,
} from "@/lib/dashboard-widgets";
import WidgetFrame from "./WidgetFrame";

const ResponsiveGridLayout = WidthProvider(Responsive);

const COLS: Record<GridBreakpoint, number> = { lg: 12, md: 6, sm: 1 };
const BREAKPOINT_PX: Record<GridBreakpoint, number> = { lg: 1024, md: 768, sm: 0 };
// A short row height gives fine vertical control, so a text header can sit just
// one short row tall (≈40px) right above the next widget. Default heights below
// are expressed in these rows, so normal widgets still open at a sensible size.
const ROW_HEIGHT = 40;

type Kind = WidgetData["widget"]["kind"];

// Default cell height (in rows) by kind: a heading is one short row; a count a
// few; an embed/list taller; a container the tallest.
function defaultH(kind: Kind) {
  if (kind === "text") return 1;
  if (kind === "action") return 2;
  if (kind === "stat") return 3;
  if (kind === "embed") return 6;
  if (kind === "image") return 5;
  if (kind === "container") return 10;
  return 8;
}

// Default placement when a widget has no stored cell for a breakpoint: two per
// row on lg/md, single column on sm (mobile is always a vertical stack).
function defaultCell(bp: GridBreakpoint, i: number, kind: Kind) {
  const h = defaultH(kind);
  if (bp === "sm") return { x: 0, y: i * 8, w: 1, h };
  if (bp === "md") return { x: (i % 2) * 3, y: Math.floor(i / 2) * 8, w: 3, h };
  return { x: (i % 2) * 6, y: Math.floor(i / 2) * 8, w: 6, h };
}

function minFor(kind: Kind) {
  if (kind === "stat") return { minW: 2, minH: 2 };
  if (kind === "action") return { minW: 2, minH: 1 };
  if (kind === "text") return { minW: 2, minH: 1 }; // a heading can be one short row
  if (kind === "embed") return { minW: 2, minH: 3 };
  if (kind === "image") return { minW: 2, minH: 2 };
  if (kind === "container") return { minW: 3, minH: 5 };
  return { minW: 3, minH: 4 };
}

// editMode is needed so a collapsed widget folds to one row in VIEW mode only —
// the forced height never persists (handleLayoutChange ignores view mode), so
// the stored expanded height survives and restores on expand.
function buildLayouts(widgets: WidgetData[], editMode: boolean): Layouts {
  const out: Layouts = { lg: [], md: [], sm: [] };
  widgets.forEach((wd, i) => {
    const kind = wd.widget.kind;
    const collapsed = !editMode && effectiveAppearance(wd.widget).collapsed;
    const min = minFor(kind);
    for (const bp of GRID_BREAKPOINTS) {
      const base = wd.widget.layout[bp] ?? defaultCell(bp, i, kind);
      const cell = collapsed ? { ...base, h: 1 } : base;
      const m = collapsed ? { minW: min.minW, minH: 1 } : min;
      (out[bp] as Layout[]).push({ i: wd.widget.id, ...cell, ...m });
    }
  });
  return out;
}

export default function RglInner({
  widgets,
  editMode,
  onLayoutChange,
  onRemove,
  onSettings,
  onAppearance,
}: {
  widgets: WidgetData[];
  editMode: boolean;
  onLayoutChange: (layouts: Layouts) => void;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
  onAppearance: (id: string, appearance: WidgetAppearance) => void;
}) {
  return (
    <ResponsiveGridLayout
      className={editMode ? "layout dash-edit" : "layout"}
      layouts={buildLayouts(widgets, editMode)}
      breakpoints={BREAKPOINT_PX}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={[16, 12]}
      containerPadding={[0, 0]}
      isDraggable={editMode}
      isResizable={editMode}
      draggableHandle=".widget-drag-handle"
      draggableCancel=".cancel-drag"
      compactType="vertical"
      onLayoutChange={(_current, all) => onLayoutChange(all)}
    >
      {widgets.map((wd) => (
        <div key={wd.widget.id}>
          <WidgetFrame
            data={wd}
            editMode={editMode}
            onRemove={onRemove}
            onSettings={onSettings}
            onAppearance={onAppearance}
          />
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
