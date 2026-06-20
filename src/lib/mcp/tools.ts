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
import { createItemFromTemplate, listTemplates } from "@/lib/templates";
import { listTypes } from "@/lib/types";
import {
  DATE_PROPERTIES,
  DUE_WINDOWS,
  SORT_FIELDS,
  getView,
  listViews,
  queryViewItems,
  type DateProperty,
  type DueWindow,
  type SortField,
  type ViewFilter,
  type ViewSort,
} from "@/lib/views";
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
  urgency: string | null;
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
        type: { type: "string", description: "Optional: restrict to one type key (e.g. task, meeting, note, person)." },
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
      "relatedTo=<person>), or meetings in the next 7 days (type=meeting, " +
      "dateField=meetingAt, withinDays=7). Bodies are not included; open an item " +
      "with get_item for its body.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Type key (e.g. task, meeting, note, link, person, or a custom type)." },
        status: { type: "string", enum: [...ITEM_STATUSES], description: "Item status filter." },
        relatedTo: { type: "string", description: "Only items with a confirmed relation to this item id (either direction)." },
        due: { type: "string", enum: [...DUE_WINDOWS], description: "Date window: overdue | today | week | none (no date)." },
        withinDays: { type: "integer", description: "Items dated today through N days out (1–366). Wins over `due`.", minimum: 1, maximum: 366 },
        dateField: { type: "string", enum: [...DATE_PROPERTIES], description: "Which date `due`/`withinDays` apply to (default dueDate; use meetingAt for meetings)." },
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
        type: { type: "string", description: "Type key (task, meeting, note, link, person, or a custom type — see list_types)." },
        title: { type: "string", description: "Item title." },
        bodyMarkdown: { type: "string", description: "Body as markdown." },
        status: { type: "string", enum: [...ITEM_STATUSES], description: "Status (default open)." },
        dueDate: { type: "string", description: "Due date, ISO 8601 (e.g. 2026-06-19). Tasks only, conventionally." },
        meetingAt: { type: "string", description: "Meeting time, ISO 8601 date-time. Meetings only." },
        urgency: { type: "string", enum: [...URGENCIES], description: "Urgency (tasks)." },
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
        urgency: { type: "string", enum: [...URGENCIES], description: "New urgency, or null to clear." },
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
      "meeting, note, link, person — plus any custom types) with each type's " +
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
      "with a person, or relate a note to a meeting. Relating an already-" +
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
      "and related items); apply_template deep-copies that prototype. Optionally " +
      "filter by type.",
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
      return {
        templates: defs.map((t) => ({
          id: t.id,
          type: t.type,
          name: t.name,
          isDefault: t.isDefault,
          prototypeItemId: t.prototypeItemId,
        })),
      };
    },
  },
  {
    name: "apply_template",
    title: "Apply template",
    description:
      "Create a new item from a template: a deep copy of the template's prototype " +
      "(its title, body, subtasks, properties, and related items), with any " +
      "{{today}}/{{title}} date tokens and {{ask:Label}} fill-in prompts resolved. " +
      "Pass `answers` (an object keyed by prompt label) to fill the {{ask:…}} " +
      "prompts; unanswered ones resolve to empty. Get the id from list_templates.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The template id (UUID), from list_templates." },
        answers: {
          type: "object",
          description: "Values for the template's {{ask:Label}} prompts, keyed by label.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const created = await createItemFromTemplate(ownerId, asUuid(args.id, "id"), {
        answers: optStringRecord(args, "answers"),
      });
      return rowView(created);
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
