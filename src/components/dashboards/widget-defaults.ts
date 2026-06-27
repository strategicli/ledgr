// Client-safe builders for a fresh widget of each kind, with sensible default
// settings + placement. Shared by DashboardClient (top-level adds) and
// ContainerWidget (child adds) so the two never drift. No DB / server imports.
import type {
  ActionKind,
  ContainerMode,
  DashboardWidget,
  WidgetLayout,
} from "@/lib/dashboard-widgets";
import type { ViewDefinition } from "@/lib/views";

export type ViewWidgetKind = "view" | "stat" | "tree";

// A view-backed widget (list / count / nested-list).
export function buildViewWidget(view: ViewDefinition, kind: ViewWidgetKind): DashboardWidget {
  const base = { id: crypto.randomUUID(), viewId: view.id, itemId: null, layout: {} as WidgetLayout };
  if (kind === "stat") return { ...base, kind, settings: { label: view.name, metric: "count" } };
  if (kind === "tree")
    return {
      ...base,
      kind,
      settings: {
        titleOverride: null,
        parentLimit: null,
        childLimit: 5,
        childSource: "children",
        relationRole: null,
        childType: null,
        hideCompletedChildren: true,
        sortOverride: null,
      },
    };
  return {
    ...base,
    kind,
    settings: { titleOverride: null, itemLimit: null, sortOverride: null, renderStyle: "compact" },
  };
}

// A text/heading block — short, sample heading, parked at the bottom (y:999 lets
// react-grid-layout compact it up).
export function buildTextWidget(): DashboardWidget {
  return {
    id: crypto.randomUUID(),
    kind: "text",
    viewId: null,
    itemId: null,
    settings: { heading: "Sample Header", body: "" },
    layout: {
      lg: { x: 0, y: 999, w: 4, h: 1 },
      md: { x: 0, y: 999, w: 3, h: 1 },
      sm: { x: 0, y: 999, w: 1, h: 1 },
    },
  };
}

export function buildActionWidget(action: ActionKind): DashboardWidget {
  const labels: Record<ActionKind, string> = {
    "quick-capture": "Quick capture",
    "new-from-template": "New from template",
    link: "Link",
  };
  return {
    id: crypto.randomUUID(),
    kind: "action",
    viewId: null,
    itemId: null,
    settings: {
      action,
      label: labels[action],
      icon: null,
      targetType: action === "quick-capture" ? "task" : null,
      templateId: null,
      href: null,
    },
    layout: {
      lg: { x: 0, y: 999, w: 3, h: 2 },
      md: { x: 0, y: 999, w: 3, h: 2 },
      sm: { x: 0, y: 999, w: 1, h: 2 },
    },
  };
}

export function buildEmbedWidget(itemId: string): DashboardWidget {
  return {
    id: crypto.randomUUID(),
    kind: "embed",
    viewId: null,
    itemId,
    settings: { showBody: true },
    layout: {},
  };
}

export function buildContainerWidget(mode: ContainerMode): DashboardWidget {
  return {
    id: crypto.randomUUID(),
    kind: "container",
    viewId: null,
    itemId: null,
    settings: { mode, title: "Group", activeTab: 0, children: [] },
    layout: {},
  };
}
