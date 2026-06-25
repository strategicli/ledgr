// The MCP tool set (ADR-047, PRD §5.5): search items, read item, create item,
// update item, list by entity/date — plus list_types so the model knows the
// type/property vocabulary before it creates or filters. Every tool is a thin
// wrapper over the same owner-scoped libs the REST API uses (search.ts,
// views.ts, items.ts, relations.ts, types.ts), so the MCP surface can never
// drift from the app's own contract or skip owner scoping. create/update reuse
// parseItemPayload, so MCP writes validate exactly like /api/items writes.
//
// A tool handler returns a plain object; callTool serializes it to MCP text
// content. Expected validation failures (ItemError) come back as an isError
// tool result so Claude sees a clean message and the session stays open;
// unexpected errors are captured (rule 9) and returned with a correlation id.
import { asUuid, parseItemPayload } from "@/lib/api";
import { makeMarkdownBody, bodyMarkdown } from "@/lib/body";
import {
  ITEM_STATUSES,
  URGENCIES,
  ItemError,
  createItem,
  getItem,
  updateItem,
} from "@/lib/items";
import { listRelatedItems, relateItems, unrelateItems } from "@/lib/relations";
import { searchItems } from "@/lib/search";
import {
  applyTemplateToExisting,
  createItemFromTemplate,
  listTemplates,
  templateAskLabels,
} from "@/lib/templates";
import {
  createType,
  listTypes,
  parseTypeInput,
  updateType,
  type TypeDefinition,
} from "@/lib/types";
import {
  DATE_PROPERTIES,
  DUE_WINDOWS,
  SORT_FIELDS,
  VIEW_LAYOUTS,
  createView,
  getView,
  listViews,
  parseViewInput,
  queryViewItems,
  updateView,
  type DateProperty,
  type DueWindow,
  type SortField,
  type ViewDefinition,
  type ViewFilter,
  type ViewSort,
} from "@/lib/views";
import {
  WIDGET_KINDS,
  addWidget,
  createDashboard,
  listDashboards,
  parseDashboardInput,
  parseWidget,
  type Dashboard,
} from "@/lib/dashboards";
import {
  NAV_DENSITIES,
  NAV_POSITIONS,
  RAIL_ANCHORS,
  RAIL_SIZES,
  getSettings,
  updateSettings,
  type NavSlotConfig,
  type UserSettings,
} from "@/lib/settings";
import { BUILD_NAV } from "@/lib/build-nav";
import { captureError } from "@/lib/log";

// --- wire types -----------------------------------------------------------

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

// Hints (MCP toolAnnotations) so a client can label/treat tools sensibly.
// openWorldHint is false everywhere: every tool reads or writes only the
// owner's own Ledgr data, never an open external system.
type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
};

type McpTool = McpToolDef & {
  handler: (ownerId: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type ToolCallResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

// --- argument helpers (hand-rolled, ItemError on bad input) ---------------

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ItemError("bad_request", `${key} must be a string`);
  const t = v.trim();
  return t === "" ? undefined : t;
}

function reqString(args: Record<string, unknown>, key: string): string {
  const v = optString(args, key);
  if (v === undefined) throw new ItemError("bad_request", `${key} is required`);
  return v;
}

function optInt(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ItemError("bad_request", `${key} must be an integer`);
  return n;
}

function optEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const v = optString(args, key);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ItemError("bad_request", `${key} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

// An object of string→string (e.g. {{ask:Label}} answers); non-string values
// are dropped. Returns undefined for a missing/empty/non-object value.
function optStringRecord(
  args: Record<string, unknown>,
  key: string
): Record<string, string> | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new ItemError("bad_request", `${key} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function optUuidArray(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ItemError("bad_request", `${key} must be an array of item ids`);
  return v.map((x) => asUuid(x, `${key} entry`));
}

// Body-free view of a row (listColumns shape) — the same fields search, list,
// create, and update all surface. Dates serialize to ISO via JSON.stringify.
function rowView(r: {
  id: string;
  type: string;
  title: string;
  status: string;
  urgency: number | null;
  dueDate: Date | null;
  meetingAt: Date | null;
  url: string | null;
  parentId: string | null;
  inbox: boolean;
  properties: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    status: r.status,
    urgency: r.urgency,
    dueDate: r.dueDate,
    meetingAt: r.meetingAt,
    url: r.url,
    parentId: r.parentId,
    inbox: r.inbox,
    properties: r.properties ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Builds the ItemInput/ItemPatch raw object for parseItemPayload from MCP args.
// MCP takes the body as a markdown string (bodyMarkdown); everything else maps
// 1:1 onto the REST item fields, so parseItemPayload does the real validation.
const WRITE_FIELDS = [
  "title",
  "status",
  "urgency",
  "dueDate",
  "meetingAt",
  "url",
  "kind",
  "properties",
  "inbox",
] as const;

function buildWriteRaw(
  args: Record<string, unknown>,
  extra: string[]
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const k of [...WRITE_FIELDS, ...extra]) {
    if (k in args && args[k] !== undefined) raw[k] = args[k];
  }
  if (args.bodyMarkdown !== undefined && args.bodyMarkdown !== null) {
    if (typeof args.bodyMarkdown !== "string") {
      throw new ItemError("bad_request", "bodyMarkdown must be a string");
    }
    raw.body = makeMarkdownBody(args.bodyMarkdown);
  }
  return raw;
}

// --- config summaries (describe_workspace + the shaping tools' returns) ----
// Body-free, index-backed config reads (rule 8). typeView/viewView echo the
// list_types/list_views shapes so a create/update tool confirms what it set;
// dashView/navView are compact summaries (describe_workspace's snapshot).

// One type with its full property detail — the list_types per-type shape, reused
// so create_type/update_type echo the stored schema back.
function typeView(t: TypeDefinition) {
  return {
    key: t.key,
    label: t.label,
    icon: t.icon,
    isSystem: t.isSystem,
    hidden: t.hidden,
    showInQuickCapture: t.showInQuickCapture,
    ...(t.capability ? { capability: t.capability } : {}),
    properties: t.propertySchema.map((p) => ({
      key: p.key,
      label: p.label,
      kind: p.kind,
      ...(p.options ? { options: p.options } : {}),
      ...(p.targetType != null ? { targetType: p.targetType } : {}),
      ...(p.cardinality ? { cardinality: p.cardinality } : {}),
    })),
  };
}

// One view's definition — the list_views shape plus columns/dateProperty, so
// create_view/update_view echo the full stored view.
function viewView(v: ViewDefinition) {
  return {
    id: v.id,
    name: v.name,
    isSystem: v.isSystem,
    layout: v.layout,
    filter: v.filter,
    sort: v.sort,
    grouping: v.grouping,
    columns: v.columns,
    dateProperty: v.dateProperty,
  };
}

// A widget's human label without resolving its backing view (no extra query,
// rule 8): the override/label/heading its settings carry, else null.
function widgetLabel(settings: unknown): string | null {
  const s = (settings ?? {}) as { titleOverride?: unknown; label?: unknown; heading?: unknown };
  for (const v of [s.titleOverride, s.label, s.heading]) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// One dashboard with a compact widget list (kind + backing viewId + label). The
// model cross-refs viewId against the views list rather than us fanning out a
// per-widget view query.
function dashView(d: Dashboard) {
  return {
    id: d.id,
    name: d.name,
    focusItemId: d.focusItemId,
    widgetCount: d.widgets.length,
    widgets: d.widgets.map((w) => ({
      id: w.id,
      kind: w.kind,
      viewId: w.viewId,
      label: widgetLabel(w.settings),
    })),
  };
}

// A nav slot, compactly: a destination's route, or a tools group's children.
function slotView(slot: NavSlotConfig) {
  if (slot.type === "tools") {
    return {
      type: "tools" as const,
      label: slot.label,
      children: slot.children.map((c) => ({ label: c.label, href: c.href, kind: c.kind })),
    };
  }
  return { type: "destination" as const, label: slot.label, href: slot.href, kind: slot.kind };
}

// The navigation shape describe_workspace + update_nav report: the layout knobs,
// the assigned home/today dashboards, and the configurable middle slots.
function navView(s: UserSettings) {
  return {
    position: s.navPosition,
    railSize: s.railSize,
    density: s.navDensity,
    railAnchor: s.railAnchor,
    homeDashboardId: s.homeDashboardId,
    todayDashboardId: s.todayDashboardId,
    slots: s.navSlots.map(slotView),
    mobileSlots: s.mobileNavSlots ? s.mobileNavSlots.map(slotView) : null,
  };
}

// --- the tools ------------------------------------------------------------

const TOOLS: McpTool[] = [
  {
    name: "search_items",
    title: "Search items",
    description:
      "Full-text search across the owner's items (titles and bodies). Use this " +
      "to find an item or a person by words — e.g. find the 'Roger' person, " +
      "or notes mentioning a topic. Returns matching items with a " +
      "highlighted snippet. To then list everything related to a person, pass " +
      "its id as relatedTo to list_items.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search words (supports \"quoted phrases\", OR, -exclude)." },
        type: { type: "string", description: "Optional: restrict to one type key (e.g. task, event, note, person)." },
        limit: { type: "integer", description: "Max results (1–50, default 50).", minimum: 1, maximum: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const rows = await searchItems(ownerId, reqString(args, "query"), {
        type: optString(args, "type"),
        limit: optInt(args, "limit"),
      });
      return {
        count: rows.length,
        items: rows.map((r) => ({ ...rowView(r), snippet: r.snippet })),
      };
    },
  },
  {
    name: "list_items",
    title: "List items",
    description:
      "List the owner's items with structured filters — by type, status, " +
      "due-date window, or related item. This is the 'list by person/date' " +
      "tool: e.g. open tasks related to a person (type=task, status=open, " +
      "relatedTo=<person>), or events in the next 7 days (type=event, " +
      "dateField=meetingAt, withinDays=7). Bodies are not included; open an item " +
      "with get_item for its body.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Type key (e.g. task, event, note, link, person, or a custom type)." },
        status: { type: "string", enum: [...ITEM_STATUSES], description: "Item status filter." },
        relatedTo: { type: "string", description: "Only items with a confirmed relation to this item id (either direction)." },
        due: { type: "string", enum: [...DUE_WINDOWS], description: "Date window: overdue | today | week | none (no date)." },
        withinDays: { type: "integer", description: "Items dated today through N days out (1–366). Wins over `due`.", minimum: 1, maximum: 366 },
        dateField: { type: "string", enum: [...DATE_PROPERTIES], description: "Which date `due`/`withinDays` apply to (default `plan` = scheduled date if set, else due; use meetingAt for events)." },
        sort: { type: "string", enum: [...SORT_FIELDS], description: "Sort field (default updatedAt)." },
        sortDir: { type: "string", enum: ["asc", "desc"], description: "Sort direction (default desc)." },
        limit: { type: "integer", description: "Max results (1–200, default 50).", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const filter: ViewFilter = {};
      const type = optString(args, "type");
      if (type) filter.type = type;
      const status = optEnum(args, "status", ITEM_STATUSES);
      if (status) filter.status = status;
      const relatedTo = args.relatedTo != null ? asUuid(args.relatedTo, "relatedTo") : undefined;
      if (relatedTo) filter.relatedTo = relatedTo;
      const dateField = optEnum<DateProperty>(args, "dateField", DATE_PROPERTIES);
      if (dateField) filter.dateField = dateField;
      const due = optEnum<DueWindow>(args, "due", DUE_WINDOWS);
      if (due) filter.due = due;
      const withinDays = optInt(args, "withinDays");
      if (withinDays !== undefined) {
        if (withinDays < 1 || withinDays > 366) {
          throw new ItemError("bad_request", "withinDays must be 1–366");
        }
        filter.withinDays = withinDays;
      }
      const sortField = optEnum<SortField>(args, "sort", SORT_FIELDS) ?? "updatedAt";
      const sortDir = optEnum(args, "sortDir", ["asc", "desc"] as const) ?? "desc";
      const sort: ViewSort = { field: sortField, dir: sortDir };
      const rows = await queryViewItems(ownerId, filter, sort, optInt(args, "limit"));
      return { count: rows.length, items: rows.map(rowView) };
    },
  },
  {
    name: "get_item",
    title: "Get item",
    description:
      "Read one item in full by id: its fields, its markdown body, and its " +
      "related items (the relations graph — backlinks, mentions, tagged " +
      "people, with each edge's role and whether it's confirmed or only " +
      "suggested). Use after search_items/list_items to read an item's contents.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item id (UUID)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const item = await getItem(ownerId, id);
      const related = await listRelatedItems(ownerId, id);
      return {
        ...rowView(item),
        body: bodyMarkdown(item.body),
        related: related.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          status: r.status,
          dueDate: r.dueDate,
          roles: r.roles,
          matchState: r.matchState,
        })),
      };
    },
  },
  {
    name: "create_item",
    title: "Create item",
    description:
      "Create a new item of a given type. Common uses: 'file this as a task due " +
      "Friday' (type=task, title, dueDate), or capture a note. Body is markdown " +
      "(bodyMarkdown). Use relateTo to link the new item to existing items by id " +
      "(e.g. relate a task to a person). Items default to filed (not in " +
      "the inbox); set inbox=true to capture for later triage. Call list_types " +
      "first if unsure which type or custom properties exist.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Type key (task, event, note, link, person, or a custom type — see list_types)." },
        title: { type: "string", description: "Item title." },
        bodyMarkdown: { type: "string", description: "Body as markdown." },
        status: { type: "string", enum: [...ITEM_STATUSES], description: "Status (default open)." },
        dueDate: { type: "string", description: "Due date, ISO 8601 (e.g. 2026-06-19). Tasks only, conventionally." },
        meetingAt: { type: "string", description: "Event start time, ISO 8601 date-time. Events only." },
        urgency: { type: "number", enum: [...URGENCIES], description: "Priority 1–6 (tasks; 1 highest)." },
        url: { type: "string", description: "URL (links)." },
        properties: { type: "object", description: "Custom property values keyed by the type's property keys (see list_types)." },
        inbox: { type: "boolean", description: "true = capture into the inbox for later triage; default false (filed)." },
        relateTo: { type: "array", items: { type: "string" }, description: "Item ids to relate this new item to (confirmed edges)." },
      },
      required: ["type"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const raw = buildWriteRaw(args, ["type"]);
      const input = parseItemPayload(raw, "create");
      const created = await createItem(ownerId, input);
      const relateTo = optUuidArray(args, "relateTo");
      for (const targetId of relateTo) {
        await relateItems(ownerId, created.id, targetId);
      }
      return { ...rowView(created), relatedTo: relateTo };
    },
  },
  {
    name: "update_item",
    title: "Update item",
    description:
      "Update fields on an existing item by id: title, status (e.g. mark a task " +
      "done), due date, urgency, body (bodyMarkdown replaces the whole body), " +
      "custom properties, etc. Only the fields you pass change. To change an " +
      "item's relations use the relations on create_item, not this tool.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item id (UUID)." },
        title: { type: "string", description: "New title." },
        bodyMarkdown: { type: "string", description: "New body markdown (replaces the entire body)." },
        status: { type: "string", enum: [...ITEM_STATUSES], description: "New status." },
        dueDate: { type: "string", description: "New due date (ISO 8601), or null to clear." },
        meetingAt: { type: "string", description: "New meeting time (ISO 8601), or null to clear." },
        urgency: { type: "number", enum: [...URGENCIES], description: "New priority 1–6, or null to clear." },
        url: { type: "string", description: "New URL, or null to clear." },
        properties: { type: "object", description: "Replace the whole custom-properties object. Prefer propertyPatch to change one key without clobbering the rest." },
        propertyPatch: { type: "object", description: "Merge these custom-property keys into the existing properties (atomic per-key; other keys untouched). Set a key to null to clear it." },
        inbox: { type: "boolean", description: "Move into (true) or out of (false) the inbox." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const patch = parseItemPayload(buildWriteRaw(args, ["propertyPatch"]), "patch");
      const updated = await updateItem(ownerId, id, patch);
      return rowView(updated);
    },
  },
  {
    name: "list_types",
    title: "List types",
    description:
      "List every item type in this Ledgr (the five system types — task, " +
      "event, note, link, person — plus any custom types) with each type's " +
      "custom properties (key, label, kind, select options, and a relation " +
      "field's target type + cardinality). Call this before create_item/" +
      "list_items when you need the exact type key or the property keys to set.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async () => {
      const defs = await listTypes();
      return {
        types: defs.map((t) => ({
          key: t.key,
          label: t.label,
          isSystem: t.isSystem,
          showInQuickCapture: t.showInQuickCapture,
          properties: t.propertySchema.map((p) => ({
            key: p.key,
            label: p.label,
            kind: p.kind,
            ...(p.options ? { options: p.options } : {}),
            // Relation fields (kind "relation") carry their target type + how
            // many they accept, so the model knows what create_item /
            // relate_items should link (ADR-067).
            ...(p.targetType != null ? { targetType: p.targetType } : {}),
            ...(p.cardinality ? { cardinality: p.cardinality } : {}),
          })),
        })),
      };
    },
  },
  {
    name: "relate_items",
    title: "Relate items",
    description:
      "Create a link (relation) between two existing items — e.g. tag a task " +
      "with a person, or relate a note to an event. Relating an already-" +
      "suggested pair confirms it (relating is the confirm gesture). The " +
      "optional role names a typed relation field (a type's 'author' or " +
      "'attendees' field, see list_types); omit it for a plain link.",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string", description: "The item the link is from (UUID)." },
        targetId: { type: "string", description: "The item the link is to (UUID)." },
        role: { type: "string", description: "Optional relation-field key (default 'related'). Can't be 'mention' (those are body-managed)." },
      },
      required: ["sourceId", "targetId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const sourceId = asUuid(args.sourceId, "sourceId");
      const targetId = asUuid(args.targetId, "targetId");
      const row = await relateItems(ownerId, sourceId, targetId, optString(args, "role"));
      return { related: true, sourceId, targetId, role: row.role, matchState: row.matchState };
    },
  },
  {
    name: "unrelate_items",
    title: "Unrelate items",
    description:
      "Remove the link(s) between two existing items — both items stay, nothing " +
      "is deleted. By default removes every non-mention edge between the pair in " +
      "both directions; pass role to remove only one typed field's edge, or " +
      "suggestedOnly=true to reject a provisional match while keeping confirmed " +
      "links.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "One item (UUID)." },
        otherId: { type: "string", description: "The other item (UUID)." },
        role: { type: "string", description: "Optional: remove only edges with this role." },
        suggestedOnly: { type: "boolean", description: "Only remove suggested (provisional) edges — the 'reject match' gesture." },
      },
      required: ["itemId", "otherId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const itemId = asUuid(args.itemId, "itemId");
      const otherId = asUuid(args.otherId, "otherId");
      const res = await unrelateItems(ownerId, itemId, otherId, {
        role: optString(args, "role"),
        suggestedOnly: args.suggestedOnly === true,
      });
      return { removed: res.removed };
    },
  },
  {
    name: "list_views",
    title: "List views",
    description:
      "List the owner's saved views (the filtered/sorted/grouped lists they've " +
      "built — 'This week's tasks', a workflow board, etc.). Returns each view's " +
      "id, name, layout, and its filter/sort/grouping so you know what it shows; " +
      "use run_view to get a view's current items.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId) => {
      const defs = await listViews(ownerId);
      return {
        views: defs.map((v) => ({
          id: v.id,
          name: v.name,
          isSystem: v.isSystem,
          layout: v.layout,
          filter: v.filter,
          sort: v.sort,
          grouping: v.grouping,
        })),
      };
    },
  },
  {
    name: "run_view",
    title: "Run view",
    description:
      "Run a saved view by id and return its current items (body-free), using " +
      "the view's own filter and sort. Get the id from list_views. This answers " +
      "'what's in my <view>' without rebuilding the filters.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The view id (UUID), from list_views." },
        limit: { type: "integer", description: "Max items (1–200).", minimum: 1, maximum: 200 },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const view = await getView(ownerId, asUuid(args.id, "id"));
      const rows = await queryViewItems(ownerId, view.filter, view.sort, optInt(args, "limit"));
      return {
        view: { id: view.id, name: view.name, layout: view.layout },
        count: rows.length,
        items: rows.map(rowView),
      };
    },
  },
  {
    name: "list_templates",
    title: "List templates",
    description:
      "List the owner's item templates — reusable starting points for new items. " +
      "Each is backed by a hidden prototype item (its body, subtasks, properties, " +
      "and related items); apply_template deep-copies that prototype. `isDefault` " +
      "marks the type's default template. `askLabels` are the {{ask:Label}} fill-in " +
      "prompts the template asks on apply — pass values for them as apply_template's " +
      "`answers`. `applyConfig` (when present) describes the due/scheduled date rules " +
      "apply will set. Optionally filter by type.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Optional: only templates for this type key." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const defs = await listTemplates(ownerId, optString(args, "type"));
      const templates = await Promise.all(
        defs.map(async (t) => ({
          id: t.id,
          type: t.type,
          name: t.name,
          isDefault: t.isDefault,
          prototypeItemId: t.prototypeItemId,
          askLabels: await templateAskLabels(ownerId, t.id),
          ...(Object.keys(t.applyConfig).length ? { applyConfig: t.applyConfig } : {}),
        }))
      );
      return { templates };
    },
  },
  {
    name: "apply_template",
    title: "Apply template",
    description:
      "Apply a template. By default (no targetId) it CREATES a new item: a deep copy " +
      "of the template's prototype (its title, body, subtasks, properties, and " +
      "related items). Pass `targetId` to instead MERGE the template onto an existing " +
      "item of the same type — `mode` 'fill' (default) sets only the target's empty " +
      "fields and adds subtasks/relations it lacks (never overwriting your edits); " +
      "'overwrite' replaces scalars + body. Either way, {{today}}/{{title}} date " +
      "tokens resolve and `answers` (an object keyed by {{ask:Label}}) fills the " +
      "fill-in prompts; unanswered ones resolve to empty. Get the id (and its " +
      "askLabels) from list_templates.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The template id (UUID), from list_templates." },
        answers: {
          type: "object",
          description: "Values for the template's {{ask:Label}} prompts, keyed by label.",
        },
        targetId: {
          type: "string",
          description:
            "Optional: an existing item's id (UUID) to merge the template ONTO instead " +
            "of creating a new item. Must be the same type as the template.",
        },
        mode: {
          type: "string",
          enum: ["fill", "overwrite"],
          description:
            "With targetId: 'fill' (default) changes only the unchanged (empty fields + " +
            "missing subtasks/relations); 'overwrite' replaces scalars + body. Ignored " +
            "without targetId.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const answers = optStringRecord(args, "answers");
      const targetIdStr = optString(args, "targetId");
      if (targetIdStr) {
        const targetId = asUuid(targetIdStr, "targetId");
        const mode = optEnum(args, "mode", ["fill", "overwrite"] as const) ?? "fill";
        const item = await applyTemplateToExisting(ownerId, id, targetId, { mode, answers });
        return rowView(item);
      }
      const created = await createItemFromTemplate(ownerId, id, { answers });
      return rowView(created);
    },
  },

  // --- workspace shaping (ADR-102): config-level writes + the read-before-write
  // snapshot. Each is a thin wrapper over the same owner-scoped parse*+create*/
  // update* libs the Build REST routes use, so safety lives in the parsers (the
  // model literally can't persist an illegal config) and the surface can't drift
  // from the app's own contract. These create/update only — there is no config
  // delete tool; destruction stays in the Build UI.
  {
    name: "describe_workspace",
    title: "Describe workspace",
    description:
      "Read-before-write orientation: a compact snapshot of the owner's whole " +
      "workspace so you can shape it correctly. Returns the types (key, label, " +
      "property count), saved views (id, name, layout), dashboards (id, name, and " +
      "a short widget list), the navigation (layout knobs + the configurable " +
      "slots + the assigned home/today dashboards), and the catalog of Build " +
      "tools a nav slot can point at. These are summaries — call list_types for a " +
      "type's full property schema, or list_views for a view's full filter/sort. " +
      "Call this first, then create_type / create_view / create_dashboard / " +
      "add_widget / update_nav to make changes. Read the 'workspace-shaping-guide' " +
      "resource for how the pieces fit together.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId) => {
      const [typeDefs, viewDefs, dashboardDefs, settings] = await Promise.all([
        listTypes({ includeHidden: true }),
        listViews(ownerId),
        listDashboards(ownerId),
        getSettings(ownerId),
      ]);
      return {
        types: typeDefs.map((t) => ({
          key: t.key,
          label: t.label,
          isSystem: t.isSystem,
          hidden: t.hidden,
          propertyCount: t.propertySchema.length,
          ...(t.capability ? { capability: t.capability } : {}),
        })),
        views: viewDefs.map((v) => ({
          id: v.id,
          name: v.name,
          isSystem: v.isSystem,
          layout: v.layout,
        })),
        dashboards: dashboardDefs.map(dashView),
        nav: navView(settings),
        // The hardcoded Build sidebar (build-nav.ts) — the destinations a Work
        // nav slot can point at (a "Clean" button → Data Hygiene, etc.).
        buildTools: BUILD_NAV.flatMap((g) =>
          g.entries.map((e) => ({ group: g.label, label: e.label, href: e.href }))
        ),
      };
    },
  },
  {
    name: "create_type",
    title: "Create type",
    description:
      "Create a new item type (a kind of item with its own custom properties) — " +
      "the 'make me a place to track X' move. `key` is a lowercase slug, " +
      "immutable once created; `label` is the display name. `propertySchema` is " +
      "the type's fields: each { key, label, kind } where kind is text | number | " +
      "date | checkbox | url | select | multi_select (these need an `options` " +
      "string array) | relation (a typed link — set `targetType` to the type key " +
      "it links to, or omit for any, plus `cardinality` single|many). Example: a " +
      "'sermon' type with a `series` select, a `date`, and a `passage` relation. " +
      "Call describe_workspace/list_types first to avoid duplicating an existing " +
      "type, and confirm the shape with the owner before creating.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Lowercase slug, immutable (letters, digits, _; starts with a letter). E.g. 'sermon'." },
        label: { type: "string", description: "Display name. E.g. 'Sermon'." },
        icon: { type: "string", description: "Optional icon key." },
        propertySchema: {
          type: "array",
          description: "The type's custom fields (see the description for the per-field shape). Omit for none.",
          items: { type: "object" },
        },
        showInQuickCapture: { type: "boolean", description: "Show this type in the quick-capture picker (default true)." },
        capability: { type: "string", description: "Optional bespoke-tool capability id (advanced; omit for the default markdown canvas)." },
      },
      required: ["key", "label"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (_ownerId, args) => {
      const created = await createType(parseTypeInput(args, "create"));
      return typeView(created);
    },
  },
  {
    name: "update_type",
    title: "Update type",
    description:
      "Edit an existing type by key. This REPLACES the type's editable fields " +
      "(label, icon, propertySchema, showInQuickCapture, capability) wholesale, " +
      "so to add one property you must resend the FULL propertySchema — read the " +
      "current one (list_types/describe_workspace) and append your addition, or " +
      "you'll drop the rest. The key is immutable and can't change here. System " +
      "types (task, event, note, link, person) can be edited but not deleted. " +
      "Confirm with the owner before changing a type that's in use.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The type's key (slug) to edit." },
        label: { type: "string", description: "Display name (required — resend the current one if unchanged)." },
        icon: { type: "string", description: "Optional icon key." },
        propertySchema: {
          type: "array",
          description: "The FULL property list to store (replaces the existing one). See create_type for the per-field shape.",
          items: { type: "object" },
        },
        showInQuickCapture: { type: "boolean", description: "Show in the quick-capture picker." },
        capability: { type: "string", description: "Bespoke-tool capability id, or omit/empty for the default canvas." },
      },
      required: ["key", "label"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (_ownerId, args) => {
      const key = reqString(args, "key").toLowerCase();
      const updated = await updateType(key, parseTypeInput(args, "patch"));
      return typeView(updated);
    },
  },
  {
    name: "create_view",
    title: "Create view",
    description:
      "Create a saved view — a named, filtered, sorted list the owner reaches by " +
      "name. `layout` is list | table | board | calendar | agenda. `filter` " +
      "scopes the items: { type, status, due (overdue|today|week|none), " +
      "dateField, withinDays, relatedTo (an item id), propertyFilters: " +
      "[{key, value}] }. Optional `sort` { field, dir }, `grouping` ({ field } or " +
      "{ propertyKey } for a board), `columns`, and `dateProperty` (which date a " +
      "calendar/agenda places items on). Example: \"This week's tasks\" = " +
      "{ name, layout:'list', filter:{ type:'task', due:'week' } }. Use run_view " +
      "afterward to confirm what it returns.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name. E.g. \"This week's tasks\"." },
        layout: { type: "string", enum: [...VIEW_LAYOUTS], description: "list | table | board | calendar | agenda." },
        filter: { type: "object", description: "Item filter (see description). Omit for an unscoped list." },
        sort: { type: "object", description: "{ field, dir } — field one of dueDate|scheduledDate|meetingAt|updatedAt|createdAt|title; dir asc|desc." },
        grouping: { type: "object", description: "Board/agenda grouping: { field: status|urgency|type|due|scheduled } or { propertyKey } for a custom select." },
        columns: { type: "array", description: "Ordered columns for list/table (advanced). Omit for the layout defaults.", items: { type: "object" } },
        dateProperty: { type: "string", enum: [...DATE_PROPERTIES], description: "Which date a calendar/agenda places items on (default dueDate; meetingAt for events)." },
      },
      required: ["name", "layout"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const created = await createView(ownerId, parseViewInput(args));
      return viewView(created);
    },
  },
  {
    name: "update_view",
    title: "Update view",
    description:
      "Edit a saved view by id. REPLACES the view's definition wholesale (name, " +
      "layout, filter, sort, grouping, columns, dateProperty), so read the " +
      "current one via list_views first and resend the full shape with your " +
      "changes. System views can't be edited. See create_view for the field " +
      "shapes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The view id (UUID), from list_views/describe_workspace." },
        name: { type: "string", description: "Display name (resend the current one if unchanged)." },
        layout: { type: "string", enum: [...VIEW_LAYOUTS], description: "list | table | board | calendar | agenda." },
        filter: { type: "object", description: "Item filter (see create_view)." },
        sort: { type: "object", description: "{ field, dir } (see create_view)." },
        grouping: { type: "object", description: "Board/agenda grouping (see create_view)." },
        columns: { type: "array", description: "Ordered columns for list/table.", items: { type: "object" } },
        dateProperty: { type: "string", enum: [...DATE_PROPERTIES], description: "Calendar/agenda date field." },
      },
      required: ["id", "name", "layout"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const updated = await updateView(ownerId, id, parseViewInput(args));
      return viewView(updated);
    },
  },
  {
    name: "create_dashboard",
    title: "Create dashboard",
    description:
      "Create a dashboard — a named grid of widgets surfaced on Work. Optionally " +
      "pass `widgets` inline, or create it empty and add_widget afterward. A " +
      "`focusItemId` scopes every view widget to items related to that item (a " +
      "person/project dashboard). Widget shape: { kind, viewId?, settings?, " +
      "layout? } — see add_widget. Because view/stat widgets reference a saved " +
      "view, create the view first (create_view) and pass its id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name. E.g. 'Sermon prep'." },
        focusItemId: { type: "string", description: "Optional item id (UUID): scope every view widget to items related to it." },
        widgets: { type: "array", description: "Optional inline widgets (see add_widget for the shape). Malformed widgets are dropped.", items: { type: "object" } },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const created = await createDashboard(ownerId, parseDashboardInput(args));
      return dashView(created);
    },
  },
  {
    name: "add_widget",
    title: "Add dashboard widget",
    description:
      "Append a widget to a dashboard. `kind` is view (a live list from a saved " +
      "view — needs viewId), stat (a single count from a view — needs viewId), " +
      "action (a button — settings.action quick-capture|new-from-template|link), " +
      "or text (a heading/note — settings.heading/body). `settings` carries the " +
      "per-kind options (a view widget's titleOverride/renderStyle; an action's " +
      "label/targetType/href). Omit `layout` to let the widget auto-place on the " +
      "grid. Create the backing view (create_view) before adding a view/stat " +
      "widget.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: { type: "string", description: "The dashboard id (UUID), from describe_workspace." },
        kind: { type: "string", enum: [...WIDGET_KINDS], description: "view | stat | action | text." },
        viewId: { type: "string", description: "The backing saved view id (UUID) — required for kind view/stat." },
        settings: { type: "object", description: "Per-kind display settings (see description)." },
        layout: { type: "object", description: "Optional grid placement per breakpoint; omit to auto-place." },
      },
      required: ["dashboardId", "kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const dashboardId = asUuid(args.dashboardId, "dashboardId");
      const widget = parseWidget({
        kind: args.kind,
        viewId: args.viewId,
        settings: args.settings,
        layout: args.layout,
      });
      if (!widget) {
        throw new ItemError(
          "bad_request",
          "invalid widget: check kind, and that a view/stat widget has a real viewId"
        );
      }
      const updated = await addWidget(ownerId, dashboardId, widget);
      return dashView(updated);
    },
  },
  {
    name: "update_nav",
    title: "Update navigation",
    description:
      "Shape the Work navigation — the owner's main toolbar. Set `navSlots` (the " +
      "configurable middle slots; a locked Home/New/More are added " +
      "automatically) and/or the layout knobs `position` (top|bottom|left|right), " +
      "`railSize` (fat|thin|hidden), `density` (spread|compact), `railAnchor` " +
      "(top|bottom|center). A slot is either { type:'destination', kind, href, " +
      "label, icon } (kind builtin|view|type|dashboard; href like /tasks, " +
      "/views/<id>, /list/<key>) or { type:'tools', label, icon, " +
      "children:[destinations] }. `mobileNavSlots` is a separate phone list (null " +
      "mirrors desktop). Read the current nav via describe_workspace first, keep " +
      "it to ~4–5 slots, and confirm with the owner. Only the fields you pass " +
      "change; passing navSlots replaces the whole middle-slot list.",
    inputSchema: {
      type: "object",
      properties: {
        navSlots: { type: "array", description: "The full ordered middle-slot list (replaces the current one). See the description for the slot shape.", items: { type: "object" } },
        mobileNavSlots: { type: "array", description: "A distinct phone slot list, or null to mirror desktop.", items: { type: "object" } },
        position: { type: "string", enum: [...NAV_POSITIONS], description: "Nav position: top | bottom | left | right." },
        railSize: { type: "string", enum: [...RAIL_SIZES], description: "Side-rail width: fat | thin | hidden." },
        density: { type: "string", enum: [...NAV_DENSITIES], description: "Packing: spread | compact." },
        railAnchor: { type: "string", enum: [...RAIL_ANCHORS], description: "Cluster anchor for a compact rail/top bar: top | bottom | center." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const patch: Partial<UserSettings> = {};
      if (args.navSlots !== undefined) {
        if (!Array.isArray(args.navSlots)) {
          throw new ItemError("bad_request", "navSlots must be an array");
        }
        patch.navSlots = args.navSlots as NavSlotConfig[];
      }
      if (args.mobileNavSlots !== undefined) {
        if (args.mobileNavSlots !== null && !Array.isArray(args.mobileNavSlots)) {
          throw new ItemError("bad_request", "mobileNavSlots must be an array or null");
        }
        patch.mobileNavSlots = args.mobileNavSlots as NavSlotConfig[] | null;
      }
      const position = optEnum(args, "position", NAV_POSITIONS);
      if (position) patch.navPosition = position;
      const railSize = optEnum(args, "railSize", RAIL_SIZES);
      if (railSize) patch.railSize = railSize;
      const density = optEnum(args, "density", NAV_DENSITIES);
      if (density) patch.navDensity = density;
      const railAnchor = optEnum(args, "railAnchor", RAIL_ANCHORS);
      if (railAnchor) patch.railAnchor = railAnchor;
      if (Object.keys(patch).length === 0) {
        throw new ItemError("bad_request", "pass at least one nav field to change");
      }
      const settings = await updateSettings(ownerId, patch);
      return navView(settings);
    },
  },
];

// The wire definitions (handler stripped) for tools/list.
export function listToolDefs(): McpToolDef[] {
  return TOOLS.map(({ handler: _handler, ...def }) => def);
}

function toolError(message: string): ToolCallResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Run a tool by name. Expected request errors (ItemError) become an isError
// result with the message; anything unexpected is captured and answered with a
// correlation id, never thrown out to the transport (the session survives).
export async function callTool(
  ownerId: string,
  name: string,
  args: unknown
): Promise<ToolCallResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return toolError(`unknown tool '${name}'`);
  const a =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  try {
    const payload = await tool.handler(ownerId, a);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  } catch (err) {
    if (err instanceof ItemError) return toolError(err.message);
    const correlationId = crypto.randomUUID();
    await captureError("mcp", err, { correlationId, detail: { tool: name } });
    return toolError(`internal error (correlationId ${correlationId})`);
  }
}
