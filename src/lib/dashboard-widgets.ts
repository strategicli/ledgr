// Client-safe dashboard widget contract: the types, the small const vocabularies,
// and the pure helpers shared by the server (src/lib/dashboards.ts — parsers +
// CRUD) and the client grid (src/components/dashboards/*). This module imports
// NO database or server-only code (only type-only imports from views), so it's
// safe in the "use client" bundle. The DB CRUD + tolerant parsers live in
// dashboards.ts and import the shapes from here.
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { ViewDefinition, ViewFilter, ViewSort } from "@/lib/views";

// --- Widget kinds & settings ---------------------------------------------

export const WIDGET_KINDS = ["view", "stat", "action", "text"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

// How a view-backed widget renders: "compact" is the cheap list preview (title
// + due chip + "+N more"); "faithful" renders the view at its own layout
// (mini table/board/calendar/agenda via the slice-27 ViewRenderer).
export const RENDER_STYLES = ["compact", "faithful"] as const;
export type RenderStyle = (typeof RENDER_STYLES)[number];

// Display overrides for a view-backed widget. None of these touch the stored
// view — they're applied in-memory at render/query time (see applySettings).
export type ViewWidgetSettings = {
  titleOverride: string | null; // null = use the view's name
  itemLimit: number | null; // null = the dashboard's default preview cap
  sortOverride: ViewSort | null; // null = the view's stored sort
  renderStyle: RenderStyle;
};

// Stat/count card: a single number from a view's filter (countViewItems).
export type StatWidgetSettings = {
  label: string; // shown under the number; "" = fall back to the view name
  metric: "count"; // forward-looking; count today
};

// Action/capture widget: non-data. quick-capture / new-from-template open a
// create surface; link is a plain navigation button.
export const ACTION_KINDS = ["quick-capture", "new-from-template", "link"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionWidgetSettings = {
  action: ActionKind;
  label: string;
  icon: string | null; // a nav-icon key (src/lib/nav-icons.ts)
  targetType: string | null; // quick-capture / new-from-template
  templateId: string | null; // new-from-template
  href: string | null; // link
};

// Text/heading widget: non-data structure — a section title (heading) over an
// optional note, for grouping/labelling widgets within the grid.
export type TextWidgetSettings = {
  heading: string;
  body: string;
};

export type WidgetSettings =
  | ViewWidgetSettings
  | StatWidgetSettings
  | ActionWidgetSettings
  | TextWidgetSettings;

// --- Grid layout (react-grid-layout). One cell per breakpoint. -----------
export const GRID_BREAKPOINTS = ["lg", "md", "sm"] as const;
export type GridBreakpoint = (typeof GRID_BREAKPOINTS)[number];
export type GridCell = { x: number; y: number; w: number; h: number };
// Sparse: a missing breakpoint falls back to react-grid-layout auto-placement.
export type WidgetLayout = Partial<Record<GridBreakpoint, GridCell>>;

// The grid is 12 columns at lg; widths clamp to this (parser + client).
export const GRID_COLS = 12;

export type DashboardWidget = {
  id: string;
  kind: WidgetKind;
  // Required for "view"/"stat" (every data widget is backed by a real view);
  // null for "action".
  viewId: string | null;
  settings: WidgetSettings;
  layout: WidgetLayout;
};

export type Dashboard = {
  id: string;
  name: string;
  position: number;
  focusItemId: string | null;
  widgets: DashboardWidget[];
  createdAt: Date;
};

// Everything the create/update form submits; the store fills id/createdAt/position.
export type DashboardInput = {
  name: string;
  focusItemId: string | null;
  widgets: DashboardWidget[];
};

// --- Wire data (server page → client grid) -------------------------------
// What the dashboard page fetches per widget and hands to the client. The full
// (body-free) ViewItem rows ride along — the compact body reads a subset, the
// layout-faithful body hands them straight to ViewRenderer. Date fields survive
// the RSC boundary as Dates (so data-changing client actions use router.refresh
// rather than reconstructing Dates from a fetch). The backing view definition is
// carried so a faithful render has the layout/columns/grouping it needs.
export type WidgetData = {
  widget: DashboardWidget;
  // Backing view definition; null for action widgets or a missing/deleted view.
  view: ViewDefinition | null;
  items: ViewItem[]; // view kind (capped); empty for stat/action
  count: number; // view/stat total
  // For a faithful board grouped by a custom property: column order + labels
  // (resolved from the view's type), mirroring the /views/[id] page.
  groupOrder?: string[];
  propertyLabels?: Record<string, string>;
  // Per-item confirmed related items (the compact list's "associated with" chip).
  related?: Record<string, { id: string; title: string; type: string }[]>;
};

// --- Pure helpers ---------------------------------------------------------

// Merge the dashboard's focus into a widget's effective filter: when focus is
// set and the widget doesn't already pin its own relation, scope it to items
// related to the focus item. viewWhere restricts relatedTo to confirmed edges,
// so this is a pure filter-merge with no new query logic.
export function applyFocus(filter: ViewFilter, focusItemId: string | null): ViewFilter {
  if (!focusItemId || filter.relatedTo) return filter;
  return { ...filter, relatedTo: focusItemId };
}

// The effective view for a layout-faithful (or compact) render: the stored view
// with the widget's display overrides applied IN MEMORY (name + sort). The
// stored view is never mutated — this is a throwaway copy for rendering.
export function applySettings(
  view: ViewDefinition,
  settings: ViewWidgetSettings
): ViewDefinition {
  return {
    ...view,
    name: settings.titleOverride || view.name,
    sort: settings.sortOverride ?? view.sort,
  };
}
