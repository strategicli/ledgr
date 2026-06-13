// Shared plumbing for the user-facing /api/items* routes: owner resolution,
// request-body parsing/validation (hand-rolled; the shapes are small and a
// validation lib isn't worth a dependency), and ItemError -> HTTP mapping.
import { NextResponse } from "next/server";
import { captureError } from "@/lib/log";
import { isItemBody } from "@/lib/body";
import { resolveOwner, type Owner } from "@/lib/owner";
import {
  ITEM_STATUSES,
  URGENCIES,
  ItemError,
  type ItemInput,
  type ItemPatch,
  type ItemStatus,
  type Urgency,
} from "@/lib/items";

// The middleware already turns signed-out API calls away; this guards the
// resolveOwner null (unknown-but-authenticated user, or keyless local run).
export async function requireOwner(): Promise<Owner | NextResponse> {
  const owner = await resolveOwner();
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return owner;
}

// ItemErrors are expected request outcomes (4xx); anything else is a real
// failure: captured to error_log (rule 9, no silent failures) and answered
// with the correlation id so a user report can be matched to its log lines.
export async function errorResponse(err: unknown): Promise<NextResponse> {
  if (err instanceof ItemError) {
    return NextResponse.json(
      { error: err.message },
      { status: err.code === "not_found" ? 404 : 400 }
    );
  }
  const correlationId = crypto.randomUUID();
  await captureError("api", err, { correlationId });
  return NextResponse.json(
    { error: "internal error", correlationId },
    { status: 500 }
  );
}

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
  if (input.meetingAt !== undefined) {
    out.meetingAt = asNullableDate(input.meetingAt, "meetingAt");
  }
  if (input.url !== undefined) out.url = asNullableString(input.url, "url");
  if (input.kind !== undefined) out.kind = asNullableString(input.kind, "kind");
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

  return mode === "create" ? (out as ItemInput) : out;
}
