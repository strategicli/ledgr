// Per-type list queries (slice 12, PRD §4.2). ViewFilter/ViewSort are the
// seed of the Phase 2 View Definitions: a views row's filter/sort jsonb
// columns store exactly these shapes, so today's hardcoded list pages become
// stored system views later without a query rewrite. Same discipline as
// every list read: owner-scoped, body-free listColumns, live items only.
import { and, asc, eq, isNull, lt, gte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import type { ItemStatus, Urgency } from "@/lib/item-enums";
import { listColumns } from "@/lib/items";
import { todayBounds } from "@/lib/today";

// Due windows compare against the calendar-day encoding (UTC midnights,
// ADR-008): overdue is strictly before today, week is today through six
// days out, none is the holding bin (no due date at all).
export const DUE_WINDOWS = ["overdue", "today", "week", "none"] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

export type ViewFilter = {
  type?: string;
  status?: ItemStatus;
  urgency?: Urgency;
  kind?: string;
  due?: DueWindow;
  // Related-to filter (tasks by entity, PRD §4.2): confirmed relations
  // edges only, either direction. Suggested edges are provisional and stay
  // out of trusted queries (PRD §3.3).
  entityId?: string;
};

export const SORT_FIELDS = [
  "dueDate",
  "meetingAt",
  "updatedAt",
  "createdAt",
  "title",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type ViewSort = { field: SortField; dir: "asc" | "desc" };

const SORT_COLUMNS = {
  dueDate: items.dueDate,
  meetingAt: items.meetingAt,
  updatedAt: items.updatedAt,
  createdAt: items.createdAt,
  title: items.title,
} as const;

const VIEW_LIMIT = 200;

// Exposed as a query builder (items.ts pattern) so verification can assert
// the generated SQL carries owner_id and selects no body.
export function viewItemsQuery(
  ownerId: string,
  filter: ViewFilter,
  sort: ViewSort = { field: "updatedAt", dir: "desc" },
  limit = VIEW_LIMIT
) {
  const where: SQL[] = [eq(items.ownerId, ownerId), isNull(items.deletedAt)];
  if (filter.type) where.push(eq(items.type, filter.type));
  if (filter.status) where.push(eq(items.status, filter.status));
  if (filter.urgency) where.push(eq(items.urgency, filter.urgency));
  if (filter.kind) where.push(eq(items.kind, filter.kind));

  if (filter.due) {
    const { dueToday, dueCutoff } = todayBounds();
    const weekCutoff = new Date(dueToday.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (filter.due === "overdue") where.push(lt(items.dueDate, dueToday));
    else if (filter.due === "today") {
      where.push(gte(items.dueDate, dueToday), lt(items.dueDate, dueCutoff));
    } else if (filter.due === "week") {
      where.push(gte(items.dueDate, dueToday), lt(items.dueDate, weekCutoff));
    } else if (filter.due === "none") where.push(isNull(items.dueDate));
  }

  if (filter.entityId) {
    where.push(sql`exists (
      select 1 from relations r
      where r.match_state = 'confirmed'
        and ((r.source_id = ${items.id} and r.target_id = ${filter.entityId})
          or (r.target_id = ${items.id} and r.source_id = ${filter.entityId}))
    )`);
  }

  // Date sorts push nulls last in both directions (an undated task belongs
  // at the bottom of a due-sorted list, not the top); updated_at breaks
  // ties so the order is stable.
  const col = SORT_COLUMNS[sort.field];
  const primary =
    sort.dir === "asc"
      ? sql`${col} asc nulls last`
      : sql`${col} desc nulls last`;

  return getDb()
    .select(listColumns)
    .from(items)
    .where(and(...where))
    .orderBy(primary, sql`${items.updatedAt} desc`)
    .limit(Math.min(Math.max(limit, 1), VIEW_LIMIT));
}

export async function queryViewItems(
  ownerId: string,
  filter: ViewFilter,
  sort?: ViewSort,
  limit?: number
) {
  return viewItemsQuery(ownerId, filter, sort, limit);
}

// Options for the entity filter selects (tasks list, search): live
// entities, title order. Body-free by construction.
export async function listEntityOptions(ownerId: string) {
  return getDb()
    .select({ id: items.id, title: items.title, kind: items.kind })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "entity"),
        isNull(items.deletedAt)
      )
    )
    .orderBy(asc(items.title))
    .limit(200);
}
