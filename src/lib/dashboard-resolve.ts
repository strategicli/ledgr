// Server-side dashboard resolution (extracted from DashboardView so both the
// /dashboards/[id] page and the Desk's read-only dashboard panel, ADR-146 S5,
// share one code path). Does the batched per-widget fan-out — view = capped
// rows + true count; stat = count; tree = parents + batched children; embed =
// the item's body; container = its children one level deep; action/text = none —
// and resolves the focus title. Owner-scoped; returns null if the dashboard is
// missing/unowned so callers can 404 or fall back.
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
import { getItem, ItemError, type ItemListRow } from "@/lib/items";
import { relatedSummaryFor } from "@/lib/relations";
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
    endAt: i.endAt,
    noteDate: i.noteDate,
    url: i.url,
    properties: i.properties,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

// Resolve one widget's wire data. Recurses once into a container's children (the
// parser drops nested containers, so it never recurses more than one level).
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

export type ResolvedDashboard = {
  id: string;
  name: string;
  focusItemId: string | null;
  focusTitle: string | null;
  appearance: DashboardAppearance | null;
  widgets: WidgetData[];
};

// Resolve a whole dashboard to its wire data. Returns null when missing/unowned.
export async function resolveDashboardData(
  ownerId: string,
  dashboardId: string
): Promise<ResolvedDashboard | null> {
  let dashboard;
  try {
    dashboard = await getDashboard(ownerId, dashboardId);
  } catch (err) {
    if (err instanceof ItemError && err.code === "not_found") return null;
    throw err;
  }

  const [widgets, focusTitle] = await Promise.all([
    Promise.all(
      dashboard.widgets.map((widget) =>
        resolveWidget(ownerId, dashboard.focusItemId, widget)
      )
    ),
    dashboard.focusItemId
      ? getItem(ownerId, dashboard.focusItemId)
          .then((it) => it.title || "Untitled")
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    id: dashboard.id,
    name: dashboard.name,
    focusItemId: dashboard.focusItemId,
    focusTitle,
    appearance: dashboard.appearance,
    widgets,
  };
}
