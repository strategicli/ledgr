// The dashboard widget-resolution fan-out, extracted from DashboardView so both
// runtimes share one source of truth (ADR-139): the cloud server component
// (src/components/dashboards/DashboardView.tsx) renders the result into
// DashboardClient, and the desktop data-router returns it as JSON over the IPC
// seam. No React here — pure @/lib reads.
//
// Per widget: view = focus-merged capped rows + true count; stat = count; tree =
// parents + batched children; embed = the item's body; container = its children
// (one level deep); action/text = none. Throws ItemError not_found when the
// dashboard is missing/unowned (callers 404 or fall back).
import type { ViewItem } from "@/components/views/ViewRenderer";
import {
  applyFocus,
  type ContainerWidgetSettings,
  type DashboardAppearance,
  type DashboardWidget,
  type TreeWidgetSettings,
  type WidgetData,
} from "@/lib/dashboard-widgets";
import { getDashboard } from "@/lib/dashboards";
import {
  childrenByParentId,
  childrenByRelation,
  TREE_PARENT_DEFAULT,
} from "@/lib/dashboard-tree";
import { getItem, type ItemListRow } from "@/lib/items";
import { ItemError } from "@/lib/items";
import { relatedSummaryFor } from "@/lib/relations";
import { getSettings } from "@/lib/settings";
import { getType } from "@/lib/types";
import { countViewItems, getView, queryViewItems, type ViewDefinition } from "@/lib/views";

const PREVIEW = 8;

async function groupingFor(view: ViewDefinition) {
  const type = view.filter.type ? await getType(view.filter.type).catch(() => null) : null;
  let groupOrder: string[] | undefined;
  const g = view.grouping;
  if (g && "propertyKey" in g) {
    groupOrder = type?.propertySchema.find((p) => p.key === g.propertyKey)?.options;
  }
  const propertyLabels: Record<string, string> = {};
  for (const p of type?.propertySchema ?? []) propertyLabels[p.key] = p.label;
  return { groupOrder, propertyLabels };
}

function toViewItem(i: ItemListRow): ViewItem {
  return {
    id: i.id,
    type: i.type,
    title: i.title,
    status: i.status,
    statusCategory: i.statusCategory,
    dueDate: i.dueDate,
    scheduledDate: i.scheduledDate,
    urgency: i.urgency,
    meetingAt: i.meetingAt,
    url: i.url,
    properties: i.properties,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

// Resolve one widget's wire data. A container recurses into its children — one
// level only, since the parser drops nested containers.
export async function resolveWidget(
  ownerId: string,
  focusItemId: string | null,
  widget: DashboardWidget
): Promise<WidgetData> {
  if (widget.kind === "action" || widget.kind === "text") {
    return { widget, view: null, items: [], count: 0 };
  }

  if (widget.kind === "embed") {
    const it = widget.itemId
      ? await getItem(ownerId, widget.itemId).catch(() => null)
      : null;
    const embedItem =
      it && !it.deletedAt ? { id: it.id, title: it.title, body: it.body } : null;
    return { widget, view: null, items: [], count: 0, embedItem };
  }

  if (widget.kind === "container") {
    const s = widget.settings as ContainerWidgetSettings;
    const childData = await Promise.all(
      s.children.map((c) => resolveWidget(ownerId, focusItemId, c))
    );
    return { widget, view: null, items: [], count: 0, childData };
  }

  // view / stat / tree are all view-backed.
  if (!widget.viewId) return { widget, view: null, items: [], count: 0 };
  try {
    const view = await getView(ownerId, widget.viewId);
    const filter = applyFocus(view.filter, focusItemId);

    if (widget.kind === "stat") {
      return { widget, view, items: [], count: await countViewItems(ownerId, filter) };
    }

    if (widget.kind === "tree") {
      const s = widget.settings as TreeWidgetSettings;
      const sort = s.sortOverride ?? view.sort;
      const parentLimit = s.parentLimit ?? TREE_PARENT_DEFAULT;
      const [parentRows, count] = await Promise.all([
        queryViewItems(ownerId, filter, sort, parentLimit),
        countViewItems(ownerId, filter),
      ]);
      const parentIds = parentRows.map((r) => r.id);
      const childMap =
        s.childSource === "relation" && s.relationRole
          ? await childrenByRelation(ownerId, parentIds, s.relationRole, {
              childType: s.childType,
              hideCompleted: s.hideCompletedChildren,
            })
          : await childrenByParentId(ownerId, parentIds, {
              childType: s.childType,
              hideCompleted: s.hideCompletedChildren,
            });
      const childrenByParent: Record<string, ViewItem[]> = {};
      const childCountByParent: Record<string, number> = {};
      for (const pid of parentIds) {
        const all = childMap.get(pid) ?? [];
        childCountByParent[pid] = all.length;
        childrenByParent[pid] = all.slice(0, s.childLimit).map(toViewItem);
      }
      return {
        widget,
        view,
        items: [],
        count,
        parents: parentRows.map(toViewItem),
        childrenByParent,
        childCountByParent,
      };
    }

    // view kind
    const limit =
      "itemLimit" in widget.settings && widget.settings.itemLimit
        ? widget.settings.itemLimit
        : PREVIEW;
    const sort =
      "sortOverride" in widget.settings && widget.settings.sortOverride
        ? widget.settings.sortOverride
        : view.sort;
    const faithful =
      "renderStyle" in widget.settings && widget.settings.renderStyle === "faithful";
    const [rows, count, grouping] = await Promise.all([
      queryViewItems(ownerId, filter, sort, limit),
      countViewItems(ownerId, filter),
      faithful ? groupingFor(view) : Promise.resolve(undefined),
    ]);
    // The compact list shows an "associated with" chip per row; the faithful
    // render uses ViewRenderer (no relation chip), so only fetch when compact.
    let related: WidgetData["related"];
    if (!faithful && rows.length > 0) {
      const summary = await relatedSummaryFor(
        ownerId,
        rows.map((r) => r.id)
      );
      related = Object.fromEntries(summary);
    }
    return {
      widget,
      view,
      items: rows.map(toViewItem),
      count,
      groupOrder: grouping?.groupOrder,
      propertyLabels: grouping?.propertyLabels,
      related,
    };
  } catch (err) {
    if (err instanceof ItemError && err.code === "not_found") {
      return { widget, view: null, items: [], count: 0 };
    }
    throw err;
  }
}

// Everything a dashboard surface needs to render: the dashboard's metadata, the
// resolved per-widget data, the focus title, and whether it's the Home/Today
// surface. Throws ItemError not_found when missing/unowned.
export type ResolvedDashboard = {
  id: string;
  name: string;
  focusItemId: string | null;
  focusTitle: string | null;
  appearance: DashboardAppearance | null;
  isHome: boolean;
  isToday: boolean;
  widgets: WidgetData[];
};

export async function resolveDashboard(
  ownerId: string,
  dashboardId: string
): Promise<ResolvedDashboard> {
  const dashboard = await getDashboard(ownerId, dashboardId);

  const widgets: WidgetData[] = await Promise.all(
    dashboard.widgets.map((widget) => resolveWidget(ownerId, dashboard.focusItemId, widget))
  );

  const [focusTitle, settings] = await Promise.all([
    dashboard.focusItemId
      ? getItem(ownerId, dashboard.focusItemId)
          .then((it) => it.title || "Untitled")
          .catch(() => null)
      : Promise.resolve(null),
    getSettings(ownerId),
  ]);

  return {
    id: dashboard.id,
    name: dashboard.name,
    focusItemId: dashboard.focusItemId,
    focusTitle,
    appearance: dashboard.appearance,
    isHome: settings.homeDashboardId === dashboard.id,
    isToday: settings.todayDashboardId === dashboard.id,
    widgets,
  };
}
