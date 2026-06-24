// View-lens render path: resolve a saved view for rendering as a tab on a
// type's list page, scoped to that type. Self-contained on purpose — it mirrors
// the per-widget orchestration in DashboardView (getView → scope → query +
// count + grouping) without importing or modifying that shared dashboards code,
// so the list-lenses feature touches no dashboard internals. Body-free and
// owner-scoped by construction (queryViewItems / countViewItems).
import type { ViewItem } from "@/components/views/ViewRenderer";
import { ItemError } from "@/lib/items";
import { getType } from "@/lib/types";
import {
  countViewItems,
  getView,
  queryViewItems,
  VIEW_LIMIT,
  type ViewDefinition,
  type ViewFilter,
} from "@/lib/views";

export type ViewLensData = {
  view: ViewDefinition;
  items: ViewItem[];
  count: number;
  groupOrder?: string[];
  propertyLabels?: Record<string, string>;
};

// Scope a view's filter to the current type, mirroring applyFocus: set the type
// only when the view doesn't already pin one, so a generic view ("Recently
// updated") becomes "this type, recently updated" on the type's list, while a
// type-specific view renders unchanged.
export function applyTypeScope(filter: ViewFilter, typeKey: string): ViewFilter {
  if (filter.type) return filter;
  return { ...filter, type: typeKey };
}

// Board column order + property labels resolved from the (scoped) view's type —
// the same metadata the /views/[id] page and DashboardView compute for a
// layout-faithful render.
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

// Resolve a view-lens for rendering. Returns null when the referenced view is
// missing/deleted, so the caller falls back to the default sorted list (the
// same try/catch posture as DashboardView's per-widget fan-out).
export async function resolveViewLens(
  ownerId: string,
  viewId: string,
  typeKey: string,
  limit = VIEW_LIMIT
): Promise<ViewLensData | null> {
  let view: ViewDefinition;
  try {
    view = await getView(ownerId, viewId);
  } catch (err) {
    if (err instanceof ItemError && err.code === "not_found") return null;
    throw err;
  }
  const scoped: ViewDefinition = { ...view, filter: applyTypeScope(view.filter, typeKey) };
  const [rows, count, grouping] = await Promise.all([
    queryViewItems(ownerId, scoped.filter, view.sort, limit),
    countViewItems(ownerId, scoped.filter),
    groupingFor(scoped),
  ]);
  return {
    view: scoped,
    items: rows.map(toViewItem),
    count,
    groupOrder: grouping.groupOrder,
    propertyLabels: grouping.propertyLabels,
  };
}
