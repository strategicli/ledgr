// Item search/list/CRUD tools (ADR-047): thin wrappers over the same
// owner-scoped libs the REST API uses (search.ts, views.ts, items.ts,
// relations.ts), so the MCP surface can never drift from the app's own
// contract or skip owner scoping. create/update reuse parseItemPayload, so
// MCP writes validate exactly like /api/items writes.
import { asUuid, parseItemPayload } from "@/lib/api";
import { BODY_WINDOW_CHARS, bodyMarkdown, isLargeBody, windowBody } from "@/lib/body";
import { ITEM_STATUSES, ItemError, URGENCIES, getItem } from "@/lib/items";
import { createItem, moveItemType, updateItem } from "@/lib/item-mutations";
import { listRelatedItems, relateItems } from "@/lib/relations";
import { searchItems } from "@/lib/search";
import {
  DATE_PROPERTIES,
  DUE_WINDOWS,
  SORT_FIELDS,
  queryViewItems,
  type DateProperty,
  type DueWindow,
  type SortField,
  type ViewFilter,
  type ViewSort,
} from "@/lib/views";
import { buildWriteRaw, optEnum, optInt, optString, optUuidArray, reqString } from "./args";
import { rowView } from "./serializers";
import type { McpTool } from "./wire";

export const itemTools: McpTool[] = [
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
      "suggested). Use after search_items/list_items to read an item's contents. " +
      "Normal-size bodies come back whole. A very large body (an imported PDF/" +
      "ebook) is PAGED so it can't flood the context: the read returns the first " +
      `~${BODY_WINDOW_CHARS} characters with a truncation marker, plus a bodyInfo ` +
      "object {totalChars, offset, returnedChars, truncated, nextOffset}. To read " +
      "more, call get_item again with bodyOffset set to the previous nextOffset.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item id (UUID)." },
        bodyOffset: {
          type: "integer",
          description:
            "Start reading the body at this character offset (default 0). Pass the " +
            "nextOffset from a previous truncated read to page through a long body.",
          minimum: 0,
        },
        bodyLimit: {
          type: "integer",
          description:
            `Max characters of body to return this read (1–${BODY_WINDOW_CHARS}, ` +
            `default ${BODY_WINDOW_CHARS}). Smaller windows page a huge body in more, ` +
            "lighter reads; a body under the limit always returns whole.",
          minimum: 1,
          maximum: BODY_WINDOW_CHARS,
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const bodyOffset = optInt(args, "bodyOffset");
      const bodyLimit = optInt(args, "bodyLimit");
      const item = await getItem(ownerId, id);
      const related = await listRelatedItems(ownerId, id);
      const relatedView = related.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        status: r.status,
        dueDate: r.dueDate,
        roles: r.roles,
        matchState: r.matchState,
      }));

      const fullText = bodyMarkdown(item.body);
      const paging = bodyOffset !== undefined || bodyLimit !== undefined;
      // A normal-size body (and no explicit paging) returns whole and byte-for-
      // byte unchanged — the body contract is untouched. Only a large body, or a
      // caller that explicitly pages, takes the windowed path below.
      if (!isLargeBody(fullText) && !paging) {
        return { ...rowView(item), body: fullText, related: relatedView };
      }

      const win = windowBody(fullText, { offset: bodyOffset, limit: bodyLimit });
      let body = win.text;
      if (win.truncated) {
        body +=
          `\n\n…[truncated: ${win.returnedChars} of ${win.totalChars} chars shown ` +
          `(offset ${win.offset}–${win.nextOffset}). Call get_item again with ` +
          `bodyOffset=${win.nextOffset} to read the next window.]`;
      }
      return {
        ...rowView(item),
        body,
        bodyInfo: {
          totalChars: win.totalChars,
          offset: win.offset,
          returnedChars: win.returnedChars,
          truncated: win.truncated,
          nextOffset: win.nextOffset,
        },
        related: relatedView,
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
    name: "move_item_type",
    title: "Change an item's type",
    description:
      "Move an item to a different type (e.g. a note that should become a " +
      "meeting). Properties the target type also has carry over; properties it " +
      "lacks are written into the body as a YAML block (and kept in the item too, " +
      "so nothing is lost). Relations are unaffected. Pass dryRun:true first to " +
      "preview what will carry over vs. be moved into the body. Call list_types " +
      "to see target types and their properties.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item id (UUID)." },
        targetType: { type: "string", description: "The type key to move the item to (see list_types)." },
        dryRun: { type: "boolean", description: "If true, return the reconciliation summary without changing the item." },
      },
      required: ["id", "targetType"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const targetType =
        typeof args.targetType === "string" ? args.targetType.trim() : "";
      if (!targetType) throw new ItemError("bad_request", "targetType is required");
      const { summary, item } = await moveItemType(ownerId, id, targetType, {
        dryRun: args.dryRun === true,
      });
      return item ? { summary, item: rowView(item) } : { summary };
    },
  },
];
