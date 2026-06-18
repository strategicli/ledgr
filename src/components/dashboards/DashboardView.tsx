// Loads one dashboard and renders its grid — the reusable core shared by the
// /dashboards/[id] route and the Home/Today surfaces (when a dashboard is
// assigned there). Server component: it does the batched per-widget fan-out
// (view = focus-merged capped rows + true count; stat = count; action = none),
// resolves the focus title, and hands it all to the client grid. Returns null if
// the dashboard is missing/unowned, so callers can 404 or fall back.
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import type { ViewItem } from "@/components/views/ViewRenderer";
import DashboardClient from "@/components/dashboards/DashboardClient";
import { applyFocus, type WidgetData } from "@/lib/dashboard-widgets";
import { getDashboard } from "@/lib/dashboards";
import { getItem } from "@/lib/items";
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

function toViewItem(i: Awaited<ReturnType<typeof queryViewItems>>[number]): ViewItem {
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

// Rendered as JSX (a normal async Server Component). When the dashboard is
// missing/unowned: render `fallback` if given (the Home/Today surfaces pass the
// fixed Today layout), otherwise 404 (the /dashboards/[id] route).
export default async function DashboardView({
  ownerId,
  dashboardId,
  fallback,
}: {
  ownerId: string;
  dashboardId: string;
  fallback?: ReactNode;
}) {
  let dashboard;
  try {
    dashboard = await getDashboard(ownerId, dashboardId);
  } catch (err) {
    if (err instanceof ItemError && err.code === "not_found") {
      if (fallback !== undefined) return <>{fallback}</>;
      notFound();
    }
    throw err;
  }

  const widgets: WidgetData[] = await Promise.all(
    dashboard.widgets.map(async (widget): Promise<WidgetData> => {
      if (widget.kind === "action" || !widget.viewId) {
        return { widget, view: null, items: [], count: 0 };
      }
      try {
        const view = await getView(ownerId, widget.viewId);
        const filter = applyFocus(view.filter, dashboard.focusItemId);
        if (widget.kind === "stat") {
          return { widget, view, items: [], count: await countViewItems(ownerId, filter) };
        }
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
    })
  );

  const [focusTitle, settings] = await Promise.all([
    dashboard.focusItemId
      ? getItem(ownerId, dashboard.focusItemId)
          .then((it) => it.title || "Untitled")
          .catch(() => null)
      : Promise.resolve(null),
    getSettings(ownerId),
  ]);

  return (
    <DashboardClient
      dashboardId={dashboard.id}
      name={dashboard.name}
      focusItemId={dashboard.focusItemId}
      focusTitle={focusTitle}
      isHome={settings.homeDashboardId === dashboard.id}
      isToday={settings.todayDashboardId === dashboard.id}
      initialWidgets={widgets}
    />
  );
}
