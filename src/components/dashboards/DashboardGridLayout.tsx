// Dynamic ssr:false wrapper around the react-grid-layout grid. RGL measures
// window width at mount, so it can't server-render; this mirrors
// LazyMarkdownEditor's dynamic-import guard. Keeping RGL behind the dynamic
// boundary also keeps its CSS/JS off pages that never show a dashboard.
//
// Two load/layout fixes live here (Home dashboard polish):
//   1. Load-flash: until RGL reports its first real layout, reserve the grid's
//      height (from the stored layout) and cover it with a skeleton, so widgets
//      never pile up diagonally during the import + measure window.
//   2. md clip: in view mode, clip horizontal bleed so the right column's
//      right-aligned metadata (names, dates, counts) can't spill past the
//      viewport edge at the md breakpoint. `overflow-x: clip` (not `hidden`)
//      leaves the y-axis `visible`, so it never turns the column into a scroll
//      container or clips edit-mode popovers. Edit mode keeps overflow open so
//      dragging a widget near the edge isn't clipped.
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { Layouts } from "react-grid-layout";
import type { WidgetAppearance, WidgetData, WidgetSettings } from "@/lib/dashboard-widgets";

type RglInnerProps = {
  widgets: WidgetData[];
  editMode: boolean;
  onLayoutChange: (layouts: Layouts) => void;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
  onAppearance: (id: string, appearance: WidgetAppearance) => void;
};

export type DashboardGridLayoutProps = RglInnerProps & {
  // Estimated grid height (px) from the stored layout, reserved during load.
  reservedHeight: number;
};

const RglInner = dynamic<RglInnerProps>(() => import("./RglInner"), {
  ssr: false,
  loading: () => null,
});

export default function DashboardGridLayout({
  reservedHeight,
  onLayoutChange,
  ...rest
}: DashboardGridLayoutProps) {
  // Flips true on RGL's first layout callback (fired on mount, after measure),
  // at which point the real grid owns its height and the reservation is dropped.
  const [measured, setMeasured] = useState(false);

  // Safety valve: release the reservation even if onLayoutChange somehow never
  // fires, so a stale min-height can't leave a permanent gap below the grid.
  useEffect(() => {
    const t = setTimeout(() => setMeasured(true), 1000);
    return () => clearTimeout(t);
  }, []);

  const handleLayoutChange = useCallback(
    (all: Layouts) => {
      setMeasured(true);
      onLayoutChange(all);
    },
    [onLayoutChange]
  );

  return (
    <div
      className={`relative ${rest.editMode ? "" : "overflow-x-clip"}`}
      style={measured ? undefined : { minHeight: reservedHeight || undefined }}
    >
      {!measured && reservedHeight > 0 && (
        <div
          aria-hidden
          className="absolute inset-0 animate-pulse rounded-card bg-surface-1"
        />
      )}
      <RglInner {...rest} onLayoutChange={handleLayoutChange} />
    </div>
  );
}
