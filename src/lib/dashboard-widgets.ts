// Client-safe dashboard widget contract: the types, the small const vocabularies,
// and the pure helpers shared by the server (src/lib/dashboards.ts — parsers +
// CRUD) and the client grid (src/components/dashboards/*). This module imports
// NO database or server-only code (only type-only imports from views), so it's
// safe in the "use client" bundle. The DB CRUD + tolerant parsers live in
// dashboards.ts and import the shapes from here.
import type { ViewItem } from "@/components/views/ViewRenderer";
import type { ViewDefinition, ViewFilter, ViewSort } from "@/lib/views";

// --- Widget kinds & settings ---------------------------------------------

// view/stat/action/text are the ADR-064/065 base. tree/embed/container are the
// dashboard-canvas additions (ADR-111 + the nested-widget follow-on):
//   • tree     — N parent items, each with its children listed under it.
//   • embed    — any item, edited in place (the sticky note is this + a color).
//   • container — a tab/stack/section holding child widgets (one-level nesting).
export const WIDGET_KINDS = ["view", "stat", "action", "text", "tree", "embed", "container"] as const;
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

// Nested-list widget (tree): N parent items (from a backing view), each with its
// children listed under it. Children come either from the parent_id item
// hierarchy ("children": subtasks under a task, sub-pages under a note) or a
// confirmed relation edge ("relation": e.g. a task's role="project" link, so a
// project lists its tasks). hideCompletedChildren defaults on so a dashboard
// shows live work. The parents are a real saved view (viewId), so filter/sort
// come free; childLimit caps the rows shown per parent before "+N more".
export const CHILD_SOURCES = ["children", "relation"] as const;
export type ChildSource = (typeof CHILD_SOURCES)[number];
export type TreeWidgetSettings = {
  titleOverride: string | null; // null = use the view's name
  parentLimit: number | null; // how many parents (null = default)
  childLimit: number; // children shown per parent before "+N more"
  childSource: ChildSource; // "children" = parent_id tree; "relation" = an edge
  relationRole: string | null; // when childSource = "relation": the edge role (e.g. "project")
  childType: string | null; // optional: only children of this type
  hideCompletedChildren: boolean; // default true (show live work)
  sortOverride: ViewSort | null; // parent sort (null = the view's stored sort)
};

// Item-embed widget: renders ONE item's title (toggled by appearance.showHeader)
// + body through the autosaving editor, editable in place. The "sticky note" is
// an embed with a colored background and the header off. Honors Principle 2:
// the content is a real, searchable, exportable item.
export type EmbedWidgetSettings = {
  showBody: boolean; // default true (a header-only embed is unusual but allowed)
};

// Tab/stack/section container: holds child widgets in its settings, displayed by
// `mode`. One-level nesting only (a container's children are never containers),
// so the server fan-out stays a single recursion.
export const CONTAINER_MODES = ["tabs", "stack", "section"] as const;
export type ContainerMode = (typeof CONTAINER_MODES)[number];
export type ContainerWidgetSettings = {
  mode: ContainerMode;
  title: string; // section label / fallback tab group title
  activeTab: number; // which tab is shown (tabs mode)
  children: DashboardWidget[]; // one level deep; parsed non-container
};

export type WidgetSettings =
  | ViewWidgetSettings
  | StatWidgetSettings
  | ActionWidgetSettings
  | TextWidgetSettings
  | TreeWidgetSettings
  | EmbedWidgetSettings
  | ContainerWidgetSettings;

// --- Per-widget appearance (cross-cutting, ADR-111 DC1) ------------------
// One optional object on every widget. Absent = today's per-kind chrome (so
// existing dashboards render identically). Present = an override the frame
// branches on, generalizing the chrome-free `text` path to all kinds.
export const WIDGET_BACKGROUNDS = [
  "panel",
  "transparent",
  "amber",
  "blue",
  "green",
  "rose",
  "violet",
  "slate",
] as const;
export type WidgetBackground = (typeof WIDGET_BACKGROUNDS)[number];

export const WIDGET_ACCENTS = ["none", "amber", "blue", "green", "rose", "violet", "slate"] as const;
export type WidgetAccent = (typeof WIDGET_ACCENTS)[number];

export type WidgetAppearance = {
  showHeader: boolean;
  showBorder: boolean;
  background: WidgetBackground;
  accent: WidgetAccent;
  collapsible: boolean;
  collapsed: boolean;
};

// Today's chrome by kind: text is structure (chrome-free); every other kind is a
// full card. effectiveAppearance() falls back to this when a widget has no saved
// appearance, so an untouched dashboard looks exactly as before.
export function defaultAppearance(kind: WidgetKind): WidgetAppearance {
  const chromeFree = kind === "text";
  return {
    showHeader: !chromeFree,
    showBorder: !chromeFree,
    background: chromeFree ? "transparent" : "panel",
    accent: "none",
    collapsible: false,
    collapsed: false,
  };
}

export function effectiveAppearance(widget: DashboardWidget): WidgetAppearance {
  return widget.appearance ?? defaultAppearance(widget.kind);
}

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
  // Required for "view"/"stat"/"tree" (each is backed by a real view); null for
  // action/text/container; the embed kind uses itemId instead.
  viewId: string | null;
  // The embedded item (kind "embed"); null otherwise.
  itemId: string | null;
  settings: WidgetSettings;
  // Per-widget chrome override (DC1). Absent = today's per-kind defaults.
  appearance?: WidgetAppearance;
  layout: WidgetLayout;
};

// --- Dashboard stage appearance (whole-board, ADR-111 DC2) ---------------
// A nullable jsonb column on dashboards. null = today's plain dark dashboard,
// untouched (never forced — the canvas_layout precedent). The grid floats over a
// full-bleed background; the scrim (a dark overlay) + blur keep widgets legible
// over a photo. value holds a curated token (color/gradient) or an image URL —
// never bytes. (Video + raw byte upload are a guarded future sub-step: the
// parser accepts "video" so the seam stays, but the UI doesn't offer it yet.)
export const STAGE_BG_KINDS = ["none", "color", "gradient", "image", "video"] as const;
export type StageBgKind = (typeof STAGE_BG_KINDS)[number];
export type StageBackground = {
  kind: StageBgKind;
  value: string; // curated color/gradient token, or an image/video URL
  scrim: number; // 0..1 darken overlay
  blur: number; // 0..1 background blur
};
export const STAGE_DENSITIES = ["comfortable", "compact"] as const;
export type StageDensity = (typeof STAGE_DENSITIES)[number];
export type DashboardAppearance = {
  background: StageBackground;
  showTitle: boolean;
  density: StageDensity;
  accent: string | null; // reserved; optional dashboard-level accent
};

// The starting point when an owner first opens the Background panel on a plain
// (null-appearance) dashboard. A mid scrim is pre-set so an image is legible.
export const DEFAULT_DASHBOARD_APPEARANCE: DashboardAppearance = {
  background: { kind: "none", value: "", scrim: 0.4, blur: 0 },
  showTitle: true,
  density: "comfortable",
  accent: null,
};

// Curated color + gradient tokens (a swatch set, not a color-picker lib —
// Principle 5). Client-safe; the page maps a token → CSS via these tables.
export const STAGE_COLOR_TOKENS: Record<string, string> = {
  slate: "#0f172a",
  ink: "#0a0a0a",
  midnight: "#0b1020",
  forest: "#0c1f17",
  wine: "#1c0f14",
  cocoa: "#1a1410",
};
export const STAGE_GRADIENT_TOKENS: Record<string, string> = {
  dusk: "linear-gradient(160deg, #1e1b4b 0%, #0f172a 60%, #020617 100%)",
  ember: "linear-gradient(160deg, #3b0d0d 0%, #1a1410 60%, #0a0a0a 100%)",
  aurora: "linear-gradient(160deg, #042f2e 0%, #0c1f2b 55%, #06070f 100%)",
  plum: "linear-gradient(160deg, #2a1037 0%, #170b2b 60%, #050510 100%)",
  steel: "linear-gradient(160deg, #1f2937 0%, #111827 60%, #030712 100%)",
};

// Resolve a stage background into a CSS value (background-color or
// background-image) for the page wrapper. Image/video resolve to the element's
// own tags, so this returns null for those (handled in the page).
export function stageBackgroundCss(
  bg: StageBackground
): { color?: string; image?: string } | null {
  if (bg.kind === "color") {
    const c = STAGE_COLOR_TOKENS[bg.value] ?? (bg.value.startsWith("#") ? bg.value : null);
    return c ? { color: c } : null;
  }
  if (bg.kind === "gradient") {
    const g = STAGE_GRADIENT_TOKENS[bg.value] ?? null;
    return g ? { image: g } : null;
  }
  return null;
}

export type Dashboard = {
  id: string;
  name: string;
  position: number;
  focusItemId: string | null;
  appearance: DashboardAppearance | null;
  widgets: DashboardWidget[];
  createdAt: Date;
};

// Everything the create/update form submits; the store fills id/createdAt/position.
export type DashboardInput = {
  name: string;
  focusItemId: string | null;
  appearance: DashboardAppearance | null;
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
  // Backing view definition; null for action/text/embed/container or a missing view.
  view: ViewDefinition | null;
  items: ViewItem[]; // view kind (capped); empty for stat/action
  count: number; // view/stat total
  // For a faithful board grouped by a custom property: column order + labels
  // (resolved from the view's type), mirroring the /views/[id] page.
  groupOrder?: string[];
  propertyLabels?: Record<string, string>;
  // Per-item confirmed related items (the compact list's "associated with" chip).
  related?: Record<string, { id: string; title: string; type: string }[]>;
  // tree kind: the parent rows, plus each parent's (capped) child rows and the
  // true child count (for the "+N more" overflow).
  parents?: ViewItem[];
  childrenByParent?: Record<string, ViewItem[]>;
  childCountByParent?: Record<string, number>;
  // embed kind: the embedded item's title + body (the one place a widget reads a
  // body — it IS the content). null when the item is missing/deleted.
  embedItem?: { id: string; title: string; body: unknown } | null;
  // container kind: the resolved data for each child widget (one level deep).
  childData?: WidgetData[];
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
