// Per-type list queries (slice 12, PRD §4.2). ViewFilter/ViewSort are the
// seed of the Phase 2 View Definitions: a views row's filter/sort jsonb
// columns store exactly these shapes, so today's hardcoded list pages become
// stored system views later without a query rewrite. Same discipline as
// every list read: owner-scoped, body-free listColumns, live items only.
import { and, asc, desc, eq, inArray, isNull, lt, gte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { items, views } from "@/db/schema";
import { type ItemStatus, type Urgency } from "@/lib/item-enums";
import { toPriority } from "@/lib/priority";
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
  // Filter by status CATEGORY bucket (S2): not_started | in_progress | done |
  // archived, or "active" = not_started+in_progress (the daily default). Keys off
  // the indexed items.status_category; `status` above is the exact-key filter.
  statusCategory?: string;
  urgency?: Urgency;
  // Which date the window applies to (default "plan" = the scheduled date if
  // set, else the due deadline — scheduled-primary, due-secondary, ADR-109).
  // "meetingAt" lets a meeting view filter by its "When". The calendar-day
  // fields (plan/dueDate/scheduledDate) compare as UTC-midnight days; the
  // timestamp fields use real timezone midnights.
  dateField?: DateProperty;
  due?: DueWindow;
  // Range window: today through today + N days (exclusive). Wins over `due`
  // when both are set. Powers "meetings in the next N days".
  withinDays?: number;
  // Related-to filter (e.g. tasks related to a person, PRD §4.2): confirmed
  // relations edges only, either direction. Suggested edges are provisional
  // and stay out of trusted queries (PRD §3.3).
  relatedTo?: string;
  // Containment refinement of relatedTo (ADR-111/PJ3). relatedHome=true narrows
  // to items CONTAINED BY relatedTo as their primary residence — a directional
  // child->parent home edge (source=item, target=relatedTo, home=true) — so a
  // record-scoped Tasks/Notes widget shows what lives here, not everything
  // tangentially related. relatedRole scopes to a single edge role (e.g.
  // "project"/"contains"). Both no-ops without relatedTo; additive (existing
  // relatedTo behavior is unchanged when neither is set).
  relatedHome?: boolean;
  relatedRole?: string;
  // Filter by a type's own select/multi_select property (the filter
  // counterpart to board grouping, slice 35): one predicate per property key.
  // A non-null value matches a scalar select or an element of a multi_select
  // array via top-level jsonb containment, so the items_properties_gin index
  // serves it; value null means "not set".
  propertyFilters?: { key: string; value: string | null }[];
  // Today's focus only (S6, ADR-086): items day-stamped into today's focus
  // (properties.focus.date == today). "Today" resolves at query time (the marker
  // auto-clears overnight, ADR-078), so it can't be a stored date; the predicate
  // is an index-backed `properties @>` containment. Powers the Top-3 widget.
  focusedToday?: boolean;
  // Untriaged bucket: items flagged inbox=true (the Tasks "Inbox" tab / quick
  // capture default). Index-backed (items_inbox_idx).
  inbox?: boolean;
};

export const SORT_FIELDS = [
  // "plan" = the effective plan date (scheduled ?? due, ADR-109).
  "plan",
  "dueDate",
  "scheduledDate",
  "meetingAt",
  "updatedAt",
  "createdAt",
  "title",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type ViewSort = { field: SortField; dir: "asc" | "desc" };

// Lens sort superset (internal to the list-lenses feature). The public ViewSort
// / parseSort and the MCP create_view contract are unchanged; only
// queryViewItems accepts the extra modes. "mostLinked" orders by the count of
// confirmed relations; "property" orders by items.properties->>key (optional
// numeric cast). Saved views and dashboards still pass a plain ViewSort.
export type ListSort =
  | ViewSort
  | { field: "mostLinked"; dir: "asc" | "desc" }
  | { field: "property"; propertyKey: string; numeric?: boolean; dir: "asc" | "desc" };

const SORT_COLUMNS = {
  dueDate: items.dueDate,
  scheduledDate: items.scheduledDate,
  meetingAt: items.meetingAt,
  updatedAt: items.updatedAt,
  createdAt: items.createdAt,
  title: items.title,
} as const;

// The effective plan date (ADR-109): the scheduled (planned) day if set, else
// the due (deadline) day. Tasks default to this everywhere a date window, sort,
// placement, or board bucket is computed, so behavior is "scheduled primarily,
// due secondarily." A task with no due date never breaks — COALESCE falls
// through to NULL, which reads as "no date" exactly like an undated task.
const PLAN_DATE = sql`coalesce(${items.scheduledDate}, ${items.dueDate})`;

// Default page size for a plain list / view render, and the increment the list
// pages "Load more" by (ADR-116). A render may request a larger window (paging)
// up to VIEW_MAX.
export const VIEW_LIMIT = 200;

// Hard ceiling on a single render: the perf backstop behind paging. "Load more"
// grows a list's window a page at a time up to this many rows, never unbounded;
// past it the user narrows with a filter or search instead. List rows are
// body-free (no body in list queries), so this is comfortably renderable for a
// single-user workspace.
export const VIEW_MAX = 2000;

// Parse the list window from a ?show= param: how many rows a plain list renders
// this load. Floors at one page (the default) and clamps to VIEW_MAX, so a
// hand-edited or stale value can never under- or over-shoot the safe range.
export function parseListWindow(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = s ? parseInt(s, 10) : NaN;
  if (!Number.isFinite(n) || n < VIEW_LIMIT) return VIEW_LIMIT;
  return Math.min(n, VIEW_MAX);
}

// The WHERE clause for a filter, shared by the list query and the count so a
// dashboard badge can never disagree with the view it labels. Owner-scoped
// and live-only by construction.
function viewWhere(ownerId: string, filter: ViewFilter): SQL[] {
  // Template prototypes are excluded from every view (ADR-093) — the same line
  // as the soft-delete filter. Covers the list/board/agenda renders, the badge
  // count, /tasks, /list/[type], saved views, dashboards, and MCP list/run.
  const where: SQL[] = [
    eq(items.ownerId, ownerId),
    isNull(items.deletedAt),
    eq(items.isTemplate, false),
  ];
  if (filter.type) where.push(eq(items.type, filter.type));
  if (filter.status) where.push(eq(items.status, filter.status));
  if (filter.statusCategory) {
    if (filter.statusCategory === "active") {
      where.push(inArray(items.statusCategory, ["not_started", "in_progress"]));
    } else {
      where.push(
        eq(
          items.statusCategory,
          filter.statusCategory as "not_started" | "in_progress" | "done" | "archived"
        )
      );
    }
  }
  if (filter.urgency) where.push(eq(items.urgency, filter.urgency));
  if (filter.inbox) where.push(eq(items.inbox, true));

  if (filter.due || filter.withinDays != null) {
    // Default to the effective plan date (scheduled ?? due, ADR-109), so an
    // undated-but-scheduled task lands in "today"/"overdue" and a missing due
    // date never hides a task. meetingAt is named explicitly by event views.
    const field = filter.dateField ?? "plan";
    // A single SQL expression either way (wrapping a column in sql`` unifies the
    // type so lt/gte/isNull take one overload); "plan" is the COALESCE.
    const col: SQL =
      field === "plan"
        ? PLAN_DATE
        : sql`${{
            dueDate: items.dueDate,
            scheduledDate: items.scheduledDate,
            meetingAt: items.meetingAt,
            createdAt: items.createdAt,
            updatedAt: items.updatedAt,
          }[field]}`;
    const b = todayBounds();
    // Due and scheduled dates are UTC-midnight calendar days (ADR-008); the
    // timestamp fields use real timezone midnights (same split as today.ts).
    // The plan date is a COALESCE of two calendar-day columns, so it's UTC too.
    // cutoff(n) is the start of the day n days from today in the right calendar.
    const isCalendarDay =
      field === "plan" || field === "dueDate" || field === "scheduledDate";
    const startToday = isCalendarDay ? b.dueToday : b.dayStart;
    const tomorrow = isCalendarDay ? b.dueCutoff : b.dayEnd;
    const cutoff = (n: number) =>
      isCalendarDay
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

  if (filter.relatedTo) {
    const roleClause = filter.relatedRole
      ? sql` and r.role = ${filter.relatedRole}`
      : sql``;
    if (filter.relatedHome) {
      // Contained children only: the item is the source of a home edge whose
      // target is the container (directional child->parent, ADR-111).
      where.push(sql`exists (
        select 1 from relations r
        where r.match_state = 'confirmed' and r.home
          and r.source_id = ${items.id} and r.target_id = ${filter.relatedTo}${roleClause}
      )`);
    } else {
      where.push(sql`exists (
        select 1 from relations r
        where r.match_state = 'confirmed'${roleClause}
          and ((r.source_id = ${items.id} and r.target_id = ${filter.relatedTo})
            or (r.target_id = ${items.id} and r.source_id = ${filter.relatedTo}))
      )`);
    }
  }

  // Custom-property predicates. A set value matches either a scalar select
  // (`{key: value}`) or one element of a multi_select array (`{key: [value]}`);
  // both are top-level jsonb containments, so the items_properties_gin index
  // serves them. value null = "not set" (key absent or empty string).
  for (const pf of filter.propertyFilters ?? []) {
    if (pf.value === null) {
      where.push(
        sql`(${items.properties} -> ${pf.key} is null or ${items.properties} ->> ${pf.key} = '')`
      );
    } else {
      where.push(
        sql`(${items.properties} @> ${JSON.stringify({
          [pf.key]: pf.value,
        })}::jsonb or ${items.properties} @> ${JSON.stringify({
          [pf.key]: [pf.value],
        })}::jsonb)`
      );
    }
  }

  // Focused-today (S6): day-stamped into today's focus. Today is resolved here,
  // not stored, so the marker's overnight auto-clear (ADR-078) holds; the
  // containment ignores the optional `order` and rides items_properties_gin.
  if (filter.focusedToday) {
    const t = todayBounds().today;
    const ymd = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    where.push(sql`${items.properties} @> ${JSON.stringify({ focus: { date: ymd } })}::jsonb`);
  }
  return where;
}

// Numeric guard for a property sort: a value that isn't a number sorts as NULL
// (last) rather than erroring the ::numeric cast.
const NUMERIC_RE = "^-?[0-9]+(\\.[0-9]+)?$";

// The primary ORDER BY expression for a ListSort. Built-in fields use their
// column (nulls last in both directions, so an undated task sits at the bottom
// of a due-sorted list, not the top); "mostLinked" orders by the confirmed-
// relation count (the relatedTo EXISTS subquery's count sibling, served by
// relations_source_idx / relations_target_idx); "property" orders by
// items.properties->>key with an optional numeric cast.
function listOrderExpr(sort: ListSort): SQL {
  const asc = sort.dir === "asc";
  if (sort.field === "mostLinked") {
    const cnt = sql`(select count(*) from relations r where r.match_state = 'confirmed' and (r.source_id = ${items.id} or r.target_id = ${items.id}))`;
    return asc ? sql`${cnt} asc` : sql`${cnt} desc`;
  }
  if (sort.field === "property") {
    const val = sql`(${items.properties} ->> ${sort.propertyKey})`;
    const expr = sort.numeric
      ? sql`(case when ${val} ~ ${NUMERIC_RE} then (${val})::numeric end)`
      : val;
    return asc ? sql`${expr} asc nulls last` : sql`${expr} desc nulls last`;
  }
  if (sort.field === "plan") {
    return asc ? sql`${PLAN_DATE} asc nulls last` : sql`${PLAN_DATE} desc nulls last`;
  }
  const col = SORT_COLUMNS[sort.field as Exclude<SortField, "plan">];
  return asc ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
}

// Exposed as a query builder (items.ts pattern) so verification can assert
// the generated SQL carries owner_id and selects no body.
export function viewItemsQuery(
  ownerId: string,
  filter: ViewFilter,
  sort: ListSort = { field: "updatedAt", dir: "desc" },
  limit = VIEW_LIMIT
) {
  const where = viewWhere(ownerId, filter);

  // updated_at breaks ties so the order is stable across renders.
  return getDb()
    .select(listColumns)
    .from(items)
    .where(and(...where))
    .orderBy(listOrderExpr(sort), sql`${items.updatedAt} desc`)
    .limit(Math.min(Math.max(limit, 1), VIEW_MAX));
}

export async function queryViewItems(
  ownerId: string,
  filter: ViewFilter,
  sort?: ListSort,
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

// Fields a board/agenda can group rows by. due/scheduled buckets reuse the
// date-window labels (overdue/today/this week/later/no date).
export const GROUP_FIELDS = ["status", "urgency", "type", "plan", "due", "scheduled"] as const;
export type GroupField = (typeof GROUP_FIELDS)[number];
// A board groups by a built-in field, or by a custom select/multi_select
// property (a workflow's "Stage", slice 35) named by its property_schema key.
export type ViewGrouping = { field: GroupField } | { propertyKey: string } | null;

// Which date a calendar/agenda places an item on, and which date a list/board
// window filters/groups by. "plan" = the effective plan date (scheduled ?? due,
// ADR-109), the task default.
export const DATE_PROPERTIES = ["plan", "dueDate", "scheduledDate", "meetingAt", "createdAt", "updatedAt"] as const;
export type DateProperty = (typeof DATE_PROPERTIES)[number];

// Columns the list + table layouts can show (Brandon feedback, 2026-06-14:
// "the items list only shows the created date — let me pick what shows"). A
// column is either a built-in field (resolved from the row) or one of the
// type's custom properties (read from items.properties by key). Title is always
// the row's primary link, so it isn't a configurable column.
export const COLUMN_FIELDS = [
  "type",
  "status",
  "urgency",
  "plan",
  "dueDate",
  "scheduledDate",
  "meetingAt",
  "createdAt",
  "updatedAt",
  "url",
] as const;
export type ColumnField = (typeof COLUMN_FIELDS)[number];
export type ViewColumn =
  | { source: "field"; key: ColumnField }
  | { source: "property"; key: string };

// --- Planner display config (ADR-131) -----------------------------------
// The interactive calendar layout's options, stored in views.display (jsonb).
// null = the defaults below, so a pre-existing calendar view is unchanged.

// The calendar sub-mode: a month grid (all-day chips) or a multi-day time-grid.
export const CALENDAR_MODES = ["month", "timegrid"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

// Which date a planner drag WRITES (and reads tasks by): the scheduled (planned)
// day, or the due deadline. Scheduled is the default — the Planner plans work,
// it doesn't move deadlines (ADR-131). The per-view "Place by Due" toggle flips it.
export const PLACE_BY = ["scheduled", "due"] as const;
export type PlaceBy = (typeof PLACE_BY)[number];

// Allowed time-grid row sizes (minutes).
export const SLOT_MINUTES = [15, 30, 60] as const;

export type ViewDisplay = {
  mode?: CalendarMode; // default "month"
  dayCount?: number; // time-grid days shown, 1–7; default 7
  slotMinutes?: number; // 15 | 30 | 60; default 30
  placeBy?: PlaceBy; // default "scheduled"
  workStartHour?: number; // 0–23, default 7
  workEndHour?: number; // 1–24, default 19; always > workStartHour
  showWeekends?: boolean; // default true
  showCalendar?: boolean; // overlay read-only synced calendar events; default false
};

// Resolved defaults for a calendar view with no (or partial) display config.
export const DISPLAY_DEFAULTS: Required<ViewDisplay> = {
  mode: "month",
  dayCount: 7,
  slotMinutes: 30,
  placeBy: "scheduled",
  workStartHour: 7,
  workEndHour: 19,
  showWeekends: true,
  showCalendar: false,
};

export type ViewDefinition = {
  id: string;
  name: string;
  isSystem: boolean;
  filter: ViewFilter;
  sort: ViewSort;
  grouping: ViewGrouping;
  // Ordered columns for the list/table layouts; null = the layout's defaults
  // (so every pre-existing view is unchanged).
  columns: ViewColumn[] | null;
  layout: ViewLayout;
  dateProperty: DateProperty | null;
  // Planner display config (ADR-131); null = DISPLAY_DEFAULTS.
  display: ViewDisplay | null;
  createdAt: Date;
};

// Everything the builder form submits; the store fills id/isSystem/createdAt.
export type ViewInput = {
  name: string;
  filter: ViewFilter;
  sort: ViewSort;
  grouping: ViewGrouping;
  columns: ViewColumn[] | null;
  layout: ViewLayout;
  dateProperty: DateProperty | null;
  // Optional in the input contract (additive, nullable): hand-built callers and
  // non-calendar views can omit it; parseViewInput always sets it (null when
  // absent), and the store coalesces undefined → null.
  display?: ViewDisplay | null;
};

export const UUID_RE =
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
  if (r.status != null) {
    // A status KEY (S2) — exact match; any slug is acceptable (the type's schema
    // gives it meaning, an unknown key simply matches nothing).
    out.status = String(r.status);
  }
  if (r.statusCategory != null) {
    const c = String(r.statusCategory);
    if (!["active", "not_started", "in_progress", "done", "archived"].includes(c)) {
      bad("filter.statusCategory invalid");
    }
    out.statusCategory = c;
  }
  if (r.urgency != null) {
    const p = toPriority(r.urgency);
    if (p === null) bad("filter.urgency invalid");
    out.urgency = p;
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
  if (r.relatedTo != null) {
    if (!UUID_RE.test(String(r.relatedTo))) bad("filter.relatedTo must be a UUID");
    out.relatedTo = String(r.relatedTo);
  }
  if (r.relatedHome != null) {
    if (typeof r.relatedHome !== "boolean") bad("filter.relatedHome must be a boolean");
    out.relatedHome = r.relatedHome;
  }
  if (r.relatedRole != null) {
    out.relatedRole = String(r.relatedRole);
  }
  if (r.propertyFilters != null) {
    if (!Array.isArray(r.propertyFilters)) {
      bad("filter.propertyFilters must be an array");
    }
    const pfs: { key: string; value: string | null }[] = [];
    const seen = new Set<string>();
    for (const entry of r.propertyFilters) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const key = String(e.key ?? "").trim();
      // One predicate per property; a malformed entry is dropped, not rejected.
      if (!key || key.length > 40 || seen.has(key)) continue;
      seen.add(key);
      pfs.push({ key, value: e.value == null ? null : String(e.value) });
    }
    if (pfs.length) out.propertyFilters = pfs;
  }
  if (r.focusedToday === true) out.focusedToday = true;
  return out;
}

// Sentinel option value meaning "not set" in a property-filter dropdown
// (distinct from "" = "any", which omits the filter). Maps to value null.
export const PROPERTY_FILTER_NONE = "__none__";

type FilterableProp = { key: string; label: string; kind: string; options?: string[] };

// The select/multi_select properties a type offers as list filters, with their
// option lists — the filter counterpart to ViewBuilder's groupPropsFor. Other
// kinds aren't offered (a free-text/number filter needs a different control);
// keep it to the classification fields.
export function propertyFilterOptions(
  schema: FilterableProp[]
): { key: string; label: string; options: string[] }[] {
  return schema
    .filter((p) => p.kind === "select" || p.kind === "multi_select")
    .map((p) => ({ key: p.key, label: p.label, options: p.options ?? [] }));
}

// Read `prop_<key>` URL params into a propertyFilters array, scoped to the
// type's select/multi_select properties (so a stray param can't inject a
// predicate). PROPERTY_FILTER_NONE → value null ("not set"); any other
// non-empty value is matched as-is.
export function propertyFiltersFromParams(
  sp: Record<string, string | string[] | undefined>,
  schema: FilterableProp[]
): { key: string; value: string | null }[] {
  const out: { key: string; value: string | null }[] = [];
  for (const p of schema) {
    if (p.kind !== "select" && p.kind !== "multi_select") continue;
    const raw = sp[`prop_${p.key}`];
    const v = typeof raw === "string" ? raw : undefined;
    if (!v) continue;
    out.push({ key: p.key, value: v === PROPERTY_FILTER_NONE ? null : v });
  }
  return out;
}

export function parseSort(raw: unknown): ViewSort {
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

// Columns: an ordered list of field/property selectors. Tolerant — a malformed
// entry is dropped, not rejected; an empty result collapses to null so the
// layout falls back to its defaults. Deduped on source:key, order preserved.
export function parseColumns(raw: unknown): ViewColumn[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) bad("columns must be an array");
  const out: ViewColumn[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const key = String(r.key ?? "").trim();
    if (!key) continue;
    if (r.source === "property") {
      if (key.length > 40) continue;
      const id = `property:${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ source: "property", key });
    } else if (r.source === "field") {
      if (!COLUMN_FIELDS.includes(key as ColumnField)) continue;
      const id = `field:${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ source: "field", key: key as ColumnField });
    }
  }
  return out.length ? out : null;
}

// Planner display config (ADR-131). Tolerant like parseColumns/parseGrouping:
// unknown or malformed fields are dropped (not rejected), out-of-range numbers
// are clamped, and an empty result collapses to null so the layout falls back
// to DISPLAY_DEFAULTS. A stale or hand-edited row can never wedge a render.
export function parseDisplay(raw: unknown): ViewDisplay | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: ViewDisplay = {};
  if (CALENDAR_MODES.includes(r.mode as CalendarMode)) out.mode = r.mode as CalendarMode;
  if (r.dayCount != null) {
    const n = Math.round(Number(r.dayCount));
    if (Number.isFinite(n)) out.dayCount = Math.min(7, Math.max(1, n));
  }
  if (r.slotMinutes != null) {
    const n = Number(r.slotMinutes);
    if ((SLOT_MINUTES as readonly number[]).includes(n)) out.slotMinutes = n;
  }
  if (PLACE_BY.includes(r.placeBy as PlaceBy)) out.placeBy = r.placeBy as PlaceBy;
  if (r.workStartHour != null) {
    const n = Math.round(Number(r.workStartHour));
    if (Number.isFinite(n)) out.workStartHour = Math.min(23, Math.max(0, n));
  }
  if (r.workEndHour != null) {
    const n = Math.round(Number(r.workEndHour));
    if (Number.isFinite(n)) out.workEndHour = Math.min(24, Math.max(1, n));
  }
  // Keep the window coherent: end must sit after start (fall back to a default
  // span rather than rejecting an inverted pair).
  if (
    out.workStartHour != null &&
    out.workEndHour != null &&
    out.workEndHour <= out.workStartHour
  ) {
    delete out.workEndHour;
  }
  if (typeof r.showWeekends === "boolean") out.showWeekends = r.showWeekends;
  if (typeof r.showCalendar === "boolean") out.showCalendar = r.showCalendar;
  return Object.keys(out).length ? out : null;
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
  // type actually has — a meeting places by "When", everything else by its
  // plan date (scheduled ?? due, ADR-109) so tasks land on their planned day.
  if ((layout === "calendar" || layout === "agenda") && !dateProperty) {
    dateProperty = filter.type === "event" ? "meetingAt" : "plan";
  }
  return {
    name,
    filter,
    sort: parseSort(r.sort),
    grouping: parseGrouping(r.grouping),
    columns: parseColumns(r.columns),
    layout,
    dateProperty,
    display: parseDisplay(r.display),
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
    columns: parseColumns(row.columns),
    layout: row.layout as ViewLayout,
    dateProperty: (row.dateProperty as DateProperty | null) ?? null,
    display: parseDisplay(row.display),
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
      columns: input.columns,
      layout: input.layout,
      dateProperty: input.dateProperty,
      display: input.display ?? null,
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
      columns: input.columns,
      layout: input.layout,
      dateProperty: input.dateProperty,
      display: input.display ?? null,
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

// (The single-dashboard pin model — listDashboardViews / pinView / unpinView /
// setDashboardOrder + the views.dashboard_order column — was retired in the
// dashboards epoch, ADR-064. Dashboards are now first-class rows; see
// src/lib/dashboards.ts.)

// Options for the person filter selects (tasks list, search, templates): live
// people, title order. Body-free by construction.
export async function listPersonOptions(ownerId: string) {
  return getDb()
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "person"),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    )
    .orderBy(asc(items.title))
    .limit(200);
}
