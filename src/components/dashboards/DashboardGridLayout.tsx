// Dynamic ssr:false wrapper around the react-grid-layout grid. RGL measures
// window width at mount, so it can't server-render; this mirrors
// LazyMarkdownEditor's dynamic-import guard. Keeping RGL behind the dynamic
// boundary also keeps its CSS/JS off pages that never show a dashboard.
"use client";

import dynamic from "next/dynamic";
import type { Layouts } from "react-grid-layout";
import type { WidgetAppearance, WidgetData, WidgetSettings } from "@/lib/dashboard-widgets";

export type DashboardGridLayoutProps = {
  widgets: WidgetData[];
  editMode: boolean;
  onLayoutChange: (layouts: Layouts) => void;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
  onAppearance: (id: string, appearance: WidgetAppearance) => void;
};

const DashboardGridLayout = dynamic<DashboardGridLayoutProps>(
  () => import("./RglInner"),
  {
    ssr: false,
    loading: () => (
      <div className="py-16 text-center text-sm text-neutral-500">Loading dashboard…</div>
    ),
  }
);

export default DashboardGridLayout;
