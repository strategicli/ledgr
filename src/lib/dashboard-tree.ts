// Batched child fetch for the nested-list (tree) dashboard widget. Two sources,
// one indexed query each (never N+1), all body-free + owner-scoped + live-only:
//   • childrenByParentId — the parent_id item hierarchy (subtasks under a task,
//     sub-pages under a note). Rides items_parent_idx.
//   • childrenByRelation — confirmed relation edges of a given role, EITHER
//     direction (the typed-relation case: a task's role="project" edge, so a
//     project lists its tasks). Mirrors relatedSummaryFor's two-pass shape.
// Both return full listColumns rows (so the widget can show status/due + a
// checkbox and honor hideCompletedChildren), grouped by parent id. The caller
// (DashboardView) caps the rows shown per parent and derives the "+N more" count
// from the full group length, so the fetch cap below only guards a pathological
// fan-out, not the display.
import { and, desc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { listColumns, type ItemListRow } from "@/lib/items";

// How many parents a tree widget shows when parentLimit is null, and the
// per-source fetch ceiling (generous for one user; the display cap is per-parent).
export const TREE_PARENT_DEFAULT = 5;
export const TREE_CHILD_FETCH_CAP = 400;

export type TreeChildOpts = {
  childType?: string | null; // only children of this type
  hideCompleted?: boolean; // drop status_category = "done"
};

// parent_id hierarchy children for a set of parent ids.
export async function childrenByParentId(
  ownerId: string,
  parentIds: string[],
  opts: TreeChildOpts = {}
): Promise<Map<string, ItemListRow[]>> {
  const out = new Map<string, ItemListRow[]>();
  if (parentIds.length === 0) return out;
  const where: SQL[] = [
    eq(items.ownerId, ownerId),
    inArray(items.parentId, parentIds),
    isNull(items.deletedAt),
    eq(items.isTemplate, false),
  ];
  if (opts.childType) where.push(eq(items.type, opts.childType));
  if (opts.hideCompleted) where.push(ne(items.statusCategory, "done"));
  const rows = await getDb()
    .select(listColumns)
    .from(items)
    .where(and(...where))
    .orderBy(desc(items.updatedAt))
    .limit(TREE_CHILD_FETCH_CAP);
  for (const r of rows) {
    if (!r.parentId) continue;
    const arr = out.get(r.parentId) ?? [];
    arr.push(r);
    out.set(r.parentId, arr);
  }
  return out;
}

// Relation-edge children for a set of parent ids and a role. Either direction
// (confirmed only), deduped per parent — so the typed-relation case (parent is
// the edge target, child the source) and the reverse both resolve.
export async function childrenByRelation(
  ownerId: string,
  parentIds: string[],
  role: string,
  opts: TreeChildOpts = {}
): Promise<Map<string, ItemListRow[]>> {
  const out = new Map<string, ItemListRow[]>();
  if (parentIds.length === 0 || !role) return out;
  const db = getDb();
  const common: SQL[] = [
    eq(relations.role, role),
    eq(relations.matchState, "confirmed"),
    eq(items.ownerId, ownerId),
    isNull(items.deletedAt),
    eq(items.isTemplate, false),
  ];
  if (opts.childType) common.push(eq(items.type, opts.childType));
  if (opts.hideCompleted) common.push(ne(items.statusCategory, "done"));

  const [asTarget, asSource] = await Promise.all([
    // parent is the TARGET, child is the SOURCE (task --role=project--> project).
    db
      .select({ anchor: relations.targetId, ...listColumns })
      .from(relations)
      .innerJoin(items, eq(items.id, relations.sourceId))
      .where(and(inArray(relations.targetId, parentIds), ...common))
      .orderBy(desc(items.updatedAt))
      .limit(TREE_CHILD_FETCH_CAP),
    // parent is the SOURCE, child is the TARGET (the other direction).
    db
      .select({ anchor: relations.sourceId, ...listColumns })
      .from(relations)
      .innerJoin(items, eq(items.id, relations.targetId))
      .where(and(inArray(relations.sourceId, parentIds), ...common))
      .orderBy(desc(items.updatedAt))
      .limit(TREE_CHILD_FETCH_CAP),
  ]);

  const anchors = new Set(parentIds);
  for (const { anchor, ...row } of [...asTarget, ...asSource]) {
    if (row.id === anchor || !anchors.has(anchor)) continue;
    const arr = out.get(anchor) ?? [];
    if (!arr.some((x) => x.id === row.id)) arr.push(row);
    out.set(anchor, arr);
  }
  return out;
}
