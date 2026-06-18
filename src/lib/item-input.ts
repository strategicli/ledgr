// Request-body parsing/validation for item create/update. Split out of api.ts
// (slice 36, ADR-047) so it stays PURE — no next/server, no auth, no DB — and
// can be imported from node contexts that aren't a route handler: the MCP tool
// layer (tools.ts) and verify scripts. api.ts re-exports these so the existing
// /api/items* routes import them unchanged. Hand-rolled (the shapes are small
// and a validation lib isn't worth a dependency, rule 5): one place that turns
// request JSON into a well-formed ItemInput/ItemPatch.
import { isItemBody } from "@/lib/body";
import {
  ITEM_STATUSES,
  URGENCIES,
  ItemError,
  type ItemInput,
  type ItemPatch,
  type ItemStatus,
  type Urgency,
} from "@/lib/items";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string): never {
  throw new ItemError("bad_request", message);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") bad(`${field} must be a string`);
  return value;
}

function asNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return asString(value, field);
}

function asNullableDate(value: unknown, field: string): Date | null {
  if (value === null) return null;
  if (typeof value !== "string") bad(`${field} must be an ISO date string`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) bad(`${field} is not a valid date`);
  return date;
}

export function asUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    bad(`${field} must be a UUID`);
  }
  return value;
}

// One parser for POST (create) and PATCH (update): same fields, except
// create requires type and rejects nothing-to-do later in the lib.
export function parseItemPayload(raw: unknown, mode: "create"): ItemInput;
export function parseItemPayload(raw: unknown, mode: "patch"): ItemPatch;
export function parseItemPayload(
  raw: unknown,
  mode: "create" | "patch"
): ItemInput | ItemPatch {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad("request body must be a JSON object");
  }
  const input = raw as Record<string, unknown>;
  const out: ItemPatch = {};

  if (input.type !== undefined) {
    const type = asString(input.type, "type");
    if (!type) bad("type must be non-empty");
    out.type = type;
  } else if (mode === "create") {
    bad("type is required");
  }

  if (input.title !== undefined) out.title = asString(input.title, "title");
  if (input.body !== undefined) {
    // The canonical body is { format, text } (markdown by default; ADR-040).
    // null clears it. Reject anything else, including the pre-cutover block
    // array, so a stale client can't write a body no renderer understands.
    if (input.body !== null && !isItemBody(input.body)) {
      bad("body must be a { format, text } object or null");
    }
    out.body = input.body;
  }
  if (input.status !== undefined) {
    if (!ITEM_STATUSES.includes(input.status as ItemStatus)) {
      bad(`status must be one of: ${ITEM_STATUSES.join(", ")}`);
    }
    out.status = input.status as ItemStatus;
  }
  if (input.urgency !== undefined) {
    if (
      input.urgency !== null &&
      !URGENCIES.includes(input.urgency as Urgency)
    ) {
      bad(`urgency must be null or one of: ${URGENCIES.join(", ")}`);
    }
    out.urgency = input.urgency as Urgency | null;
  }
  if (input.dueDate !== undefined) {
    out.dueDate = asNullableDate(input.dueDate, "dueDate");
  }
  if (input.scheduledDate !== undefined) {
    out.scheduledDate = asNullableDate(input.scheduledDate, "scheduledDate");
  }
  if (input.meetingAt !== undefined) {
    out.meetingAt = asNullableDate(input.meetingAt, "meetingAt");
  }
  if (input.url !== undefined) out.url = asNullableString(input.url, "url");
  if (input.parentId !== undefined) {
    out.parentId =
      input.parentId === null ? null : asUuid(input.parentId, "parentId");
  }
  if (input.inbox !== undefined) {
    if (typeof input.inbox !== "boolean") bad("inbox must be a boolean");
    out.inbox = input.inbox;
  }
  if (input.properties !== undefined) {
    if (
      input.properties !== null &&
      (typeof input.properties !== "object" || Array.isArray(input.properties))
    ) {
      bad("properties must be an object or null");
    }
    out.properties = input.properties as Record<string, unknown> | null;
  }
  // Per-key merge into items.properties (ADR-069 canvas cards): an object whose
  // keys are merged, not replaced. Patch-only — create uses `properties`.
  if (input.propertyPatch !== undefined) {
    if (
      input.propertyPatch === null ||
      typeof input.propertyPatch !== "object" ||
      Array.isArray(input.propertyPatch)
    ) {
      bad("propertyPatch must be an object");
    }
    out.propertyPatch = input.propertyPatch as Record<string, unknown>;
  }

  return mode === "create" ? (out as ItemInput) : out;
}
