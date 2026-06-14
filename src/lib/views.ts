// Per-type list queries (slice 12, PRD §4.2). ViewFilter/ViewSort are the
// seed of the Phase 2 View Definitions: a views row's filter/sort jsonb
// columns store exactly these shapes, so today's hardcoded list pages become
// stored system views later without a query rewrite. Same discipline as
// every list read: owner-scoped, body-free listColumns, live items only.
import { and, asc, desc, eq, isNotNull, isNull, lt, gte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { items, views } from "@/db/schema";
import { ITEM_STATUSES, URGENCIES, type ItemStatus, type Urgency } from "@/lib/item-enums";
import { ItemError, listColumns } from "@/lib/items";
import { APP_TIMEZONE, todayBounds, zonedMidnightUtc } from "@/lib/today";

// Date windows. "overdue" is strictly before today (for a meeting, "in the
// past"); "today" is the single day; "week" is today through six days out;
// "none" is the holding bin (no date at all). The window applies to whichever
// date the filter names (dateField) — due date by default, or a meeting's
// "When", so "meetings today" is expressible.
export const DUE_WINDOWS = ["overdue", "today", "week", "none"] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

export type ViewFilter = {
  type?: string;
  status?: ItemStatus;
  urgency?: Urgency;
  kind?: string;
  // Which date the window applies to (default "dueDate"). "meetingAt" lets a
  // meeting view filter by its "When"; due-date semantics are UTC-midnight
  // calendar days, the timestamp fields use real timezone midnights.
  dateField?: DateProperty;
  due?: DueWindow;
  // Range window: today through today + N days (exclusive). Wins over `due`
  // when both are set. Powers "meetings in the next N days".
  withinDays?: number;
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

// The WHERE clause for a filter, shared by the list query and the count so a
// dashboard badge can never disagree with the view it labels. Owner-scoped
// and live-only by construction.
function viewWhere(ownerId: string, filter: ViewFilter): SQL[] {
  const where: SQL[] = [eq(items.ownerId, ownerId), isNull(items.deletedAt)];
  if (filter.type) where.push(eq(items.type, filter.type));
  if (filter.status) where.push(eq(items.status, filter.status));
  if (filter.urgency) where.push(eq(items.urgency, filter.urgency));
  if (filter.kind) where.push(eq(items.kind, filter.kind));

  if (filter.due || filter.withinDays != null) {
    const field = filter.dateField ?? "dueDate";
    const col = {
      dueDate: items.dueDate,
      meetingAt: items.meetingAt,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    }[field];
    const b = todayBounds();
    // Due dates are UTC-midnight calendar days; the timestamp fields use real
    // timezone midnights (same split as today.ts). cutoff(n) is the start of
    // the day n days from today in the right calendar.
    const isDue = field === "dueDate";
    const startToday = isDue ? b.dueToday : b.dayStart;
    const tomorrow = isDue ? b.dueCutoff : b.dayEnd;
    const cutoff = (n: number) =>
      isDue
        ? new Date(Date.UTC(b.today.y, b.today.m - 1, b.today.d + n))
        : zonedMidnightUtc({ ...b.today, d: b.today.d + n }, APP_TIMEZONE);

    if (filter.withinDays != null) {
      where.push(gte(col, startToday), lt(col, cutoff(filter.withinDays)));
    } else if (filter.due === "overdue") where.push(lt(col, startToday));
    else if (filter.due === "today") {
      where.push(gte(col, startToday), lt(col, tomorrow));
    } else if (filter.due === "week") {
      where.push(gte(col, startToday), lt(col, cutoff(7)));
    } else if (filter.due === "none") where.push(isNull(col));
  }

  if (filter.entityId) {
    where.push(sql`exists (
      select 1 from relations r
      where r.match_state = 'confirmed'
        and ((r.source_id = ${items.id} and r.target_id = ${filter.entityId})
          or (r.target_id = ${items.id} and r.source_id = ${filter.entityId}))
    )`);
  }
  return where;
}

// Exposed as a query builder (items.ts pattern) so verification can assert
// the generated SQL carries owner_id and selects no body.
export function viewItemsQuery(
  ownerId: string,
  filter: ViewFilter,
  sort: ViewSort = { field: "updatedAt", dir: "desc" },
  limit = VIEW_LIMIT
) {
  const where = viewWhere(ownerId, filter);

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

// Badge count for a view (slice 29): the true number of matching items,
// independent of the list's display limit. Shares viewWhere with the list.
export async function countViewItems(
  ownerId: string,
  filter: ViewFilter
): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(and(...viewWhere(ownerId, filter)));
  return rows[0].count;
}

// --- Stored View Definitions (slice 27, PRD §4.2/§4.9) -------------------
// A views row's filter/sort/grouping jsonb columns store exactly the shapes
// above; layout/date_property are real columns. The five layouts render the
// same owner-scoped, body-free item set different ways.

export const VIEW_LAYOUTS = ["list", "table", "board", "calendar", "agenda"] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

// Fields a board/agenda can group rows by. due buckets reuse DUE_WINDOWS.
export const GROUP_FIELDS = ["status", "urgency", "kind", "type", "due"] as const;
export type GroupField = (typeof GROUP_FIELDS)[number];
// A board groups by a built-in field, or by a custom select/multi_select
// property (a workflow's "Stage", slice 35) named by its property_schema key.
export type ViewGrouping = { field: GroupField } | { propertyKey: string } | null;

// Which date a calendar/agenda places an item on.
export const DATE_PROPERTIES = ["dueDate", "meetingAt", "createdAt", "updatedAt"] as const;
export type DateProperty = (typeof DATE_PROPERTIES)[number];

export type ViewDefinition = {
  id: string;
  name: string;
  isSystem: boolean;
  filter: ViewFilter;
  sort: ViewSort;
  grouping: ViewGrouping;
  layout: ViewLayout;
  dateProperty: DateProperty | null;
  // null = not on the dashboard; a number is its widget position (slice 29).
  dashboardOrder: number | null;
  createdAt: Date;
};

// Everything the builder form submits; the store fills id/isSystem/createdAt.
export type ViewInput = {
  name: string;
  filter: ViewFilter;
  sort: ViewSort;
  grouping: ViewGrouping;
  layout: ViewLayout;
  dateProperty: DateProperty | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string): never {
  throw new ItemError("bad_request", message);
}

// Hand-rolled validation (same discipline as api.ts): the shapes are small
// and a schema lib isn't worth a dependency (rule 5). Unknown keys are
// dropped, not rejected, so an old client can't wedge a save.
export function parseViewFilter(raw: unknown): ViewFilter {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) bad("filter must be an object");
  const r = raw as Record<string, unknown>;
  const out: ViewFilter = {};
  if (r.type != null) out.type = String(r.type);
  if (r.kind != null) out.kind = String(r.kind);
  if (r.status != null) {
    if (!ITEM_STATUSES.includes(r.status as ItemStatus)) bad("filter.status invalid");
    out.status = r.status as ItemStatus;
  }
  if (r.urgency != null) {
    if (!URGENCIES.includes(r.urgency as Urgency)) bad("filter.urgency invalid");
    out.urgency = r.urgency as Urgency;
  }
  if (r.dateField != null) {
    if (!DATE_PROPERTIES.includes(r.dateField as DateProperty)) {
      bad("filter.dateField invalid");
    }
    out.dateField = r.dateField as DateProperty;
  }
  if (r.due != null) {
    if (!DUE_WINDOWS.includes(r.due as DueWindow)) bad("filter.due invalid");
    out.due = r.due as DueWindow;
  }
  if (r.withinDays != null) {
    const n = Number(r.withinDays);
    if (!Number.isInteger(n) || n < 1 || n > 366) {
      bad("filter.withinDays must be an integer 1–366");
    }
    out.withinDays = n;
  }
  if (r.entityId != null) {
    if (!UUID_RE.test(String(r.entityId))) bad("filter.entityId must be a UUID");
    out.entityId = String(r.entityId);
  }
  return out;
}

function parseSort(raw: unknown): ViewSort {
  if (raw == null) return { field: "updatedAt", dir: "desc" };
  if (typeof raw !== "object" || Array.isArray(raw)) bad("sort must be an object");
  const r = raw as Record<string, unknown>;
  const field = r.field as SortField;
  if (!SORT_FIELDS.includes(field)) bad("sort.field invalid");
  const dir = r.dir === "asc" ? "asc" : "desc";
  return { field, dir };
}

function parseGrouping(raw: unknown): ViewGrouping {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) bad("grouping must be an object or null");
  const r = raw as Record<string, unknown>;
  // A property grouping wins when present (a board by a custom select field).
  if (r.propertyKey != null && r.propertyKey !== "") {
    const key = String(r.propertyKey).trim();
    if (!key || key.length > 40) bad("grouping.propertyKey invalid");
    return { propertyKey: key };
  }
  const field = r.field as GroupField;
  if (!GROUP_FIELDS.includes(field)) bad("grouping.field invalid");
  return { field };
}

export function parseViewInput(raw: unknown): ViewInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad("request body must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) bad("name is required");
  if (name.length > 120) bad("name too long");
  const layout = r.layout as ViewLayout;
  if (!VIEW_LAYOUTS.includes(layout)) bad("layout invalid");
  const filter = parseViewFilter(r.filter);
  let dateProperty: DateProperty | null = null;
  if (r.dateProperty != null) {
    if (!DATE_PROPERTIES.includes(r.dateProperty as DateProperty)) {
      bad("dateProperty invalid");
    }
    dateProperty = r.dateProperty as DateProperty;
  }
  // Calendar/agenda need a date to place items on; default to the one the
  // type actually has — a meeting has no due date, so it places by "When".
  if ((layout === "calendar" || layout === "agenda") && !dateProperty) {
    dateProperty = filter.type === "meeting" ? "meetingAt" : "dueDate";
  }
  return {
    name,
    filter,
    sort: parseSort(r.sort),
    grouping: parseGrouping(r.grouping),
    layout,
    dateProperty,
  };
}

// Drizzle returns the jsonb columns as unknown; coerce through the parsers so
// a hand-edited or legacy row still yields a well-formed definition.
function rowToDefinition(row: typeof views.$inferSelect): ViewDefinition {
  return {
    id: row.id,
    name: row.name,
    isSystem: row.isSystem,
    filter: parseViewFilter(row.filter),
    sort: parseSort(row.sort),
    grouping: parseGrouping(row.grouping),
    layout: row.layout as ViewLayout,
    dateProperty: (row.dateProperty as DateProperty | null) ?? null,
    dashboardOrder: row.dashboardOrder,
    createdAt: row.createdAt,
  };
}

export async function listViews(ownerId: string): Promise<ViewDefinition[]> {
  const rows = await getDb()
    .select()
    .from(views)
    .where(eq(views.ownerId, ownerId))
    .orderBy(desc(views.isSystem), asc(views.name));
  return rows.map(rowToDefinition);
}

export async function getView(
  ownerId: string,
  id: string
): Promise<ViewDefinition> {
  const rows = await getDb()
    .select()
    .from(views)
    .where(and(eq(views.id, id), eq(views.ownerId, ownerId)));
  if (rows.length === 0) throw new ItemError("not_found", "view not found");
  return rowToDefinition(rows[0]);
}

export async function createView(
  ownerId: string,
  input: ViewInput
): Promise<ViewDefinition> {
  const rows = await getDb()
    .insert(views)
    .values({
      ownerId,
      name: input.name,
      filter: input.filter,
      sort: input.sort,
      grouping: input.grouping,
      layout: input.layout,
      dateProperty: input.dateProperty,
    })
    .returning();
  return rowToDefinition(rows[0]);
}

export async function updateView(
  ownerId: string,
  id: string,
  input: ViewInput
): Promise<ViewDefinition> {
  const existing = await getView(ownerId, id); // ownership + existence
  if (existing.isSystem) bad("system views can't be edited");
  const rows = await getDb()
    .update(views)
    .set({
      name: input.name,
      filter: input.filter,
      sort: input.sort,
      grouping: input.grouping,
      layout: input.layout,
      dateProperty: input.dateProperty,
    })
    .where(and(eq(views.id, id), eq(views.ownerId, ownerId)))
    .returning();
  return rowToDefinition(rows[0]);
}

export async function deleteView(ownerId: string, id: string): Promise<void> {
  const existing = await getView(ownerId, id);
  if (existing.isSystem) bad("system views can't be deleted");
  await getDb()
    .delete(views)
    .where(and(eq(views.id, id), eq(views.ownerId, ownerId)));
}

// --- Dashboard (slice 29, PRD §4.11) -------------------------------------
// The dashboard is the owner's pinned views in order. dashboard_order is the
// whole config: non-null = pinned, the number = grid position.

export async function listDashboardViews(
  ownerId: string
): Promise<ViewDefinition[]> {
  const rows = await getDb()
    .select()
    .from(views)
    .where(and(eq(views.ownerId, ownerId), isNotNull(views.dashboardOrder)))
    .orderBy(asc(views.dashboardOrder), asc(views.name));
  return rows.map(rowToDefinition);
}

// Pin a view to the end of the dashboard (no-op if already pinned).
export async function pinView(ownerId: string, id: string): Promise<void> {
  const view = await getView(ownerId, id); // ownership + existence
  if (view.dashboardOrder != null) return;
  const rows = await getDb()
    .select({ max: sql<number | null>`max(${views.dashboardOrder})` })
    .from(views)
    .where(eq(views.ownerId, ownerId));
  const next = (rows[0].max ?? -1) + 1;
  await getDb()
    .update(views)
    .set({ dashboardOrder: next })
    .where(and(eq(views.id, id), eq(views.ownerId, ownerId)));
}

export async function unpinView(ownerId: string, id: string): Promise<void> {
  await getView(ownerId, id); // ownership + existence
  await getDb()
    .update(views)
    .set({ dashboardOrder: null })
    .where(and(eq(views.id, id), eq(views.ownerId, ownerId)));
}

// Persist a drag-reorder: the ids are the pinned views in their new order.
// Each gets its index as dashboard_order; ids not owned by the caller are
// skipped, so a stale client can't reorder someone else's views.
export async function setDashboardOrder(
  ownerId: string,
  orderedIds: string[]
): Promise<void> {
  const db = getDb();
  await Promise.all(
    orderedIds.map((id, i) =>
      db
        .update(views)
        .set({ dashboardOrder: i })
        .where(and(eq(views.id, id), eq(views.ownerId, ownerId)))
    )
  );
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
