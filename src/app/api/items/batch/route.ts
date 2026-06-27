import { NextResponse } from "next/server";
import {
  asUuid,
  errorResponse,
  parseItemPayload,
  requireOwner,
} from "@/lib/api";
import { ItemError, softDeleteItem, updateItem } from "@/lib/items";
import { captureError } from "@/lib/log";

// Bulk item operations for the multi-select layer (ADR-118). The in-app
// counterpart to the machine batch route (/api/machine/items): user-auth via
// requireOwner, same one-patch-per-id loop, same validate-through-the-shared-
// parser discipline so this surface can't drift from the item contract or skip
// owner-scoping. Each entry is independent — a bad id is reported in `errors`
// and skipped, never failing the rest. The client (BulkActionBar) chunks larger
// selections into MAX_BATCH-sized requests.
export const dynamic = "force-dynamic";

const MAX_BATCH = 200; // matches the list page window (VIEW_LIMIT)

function parseIds(body: unknown): { ids: string[] } | { error: string } {
  const ids = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids)) return { error: "ids must be an array" };
  if (ids.length === 0) return { ids: [] };
  if (ids.length > MAX_BATCH) {
    return { error: `too many ids (max ${MAX_BATCH} per request)` };
  }
  return { ids: ids.map(String) };
}

// PATCH /api/items/batch — apply ONE patch to many items.
// Body: { ids: string[], patch: { status?, dueDate?, scheduledDate?, parentId?,
// properties?, propertyPatch?, ... } }. The patch is the same shape PATCH
// /api/items/:id takes, validated once through parseItemPayload, then applied to
// each id via the same updateItem (so parent-id changes still run
// assertValidParent, recurrence status changes still advance, etc.).
// Response: { count, errors: [{ id, error }] }; 200 if anything updated, 400 if
// every entry failed (or the request was malformed).
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = parseIds(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.ids.length === 0) {
    return NextResponse.json({ count: 0, errors: [] });
  }

  // Validate the shared patch once — a bad patch is a 400 for the whole request,
  // not a per-id error (every id would fail it identically).
  let patch;
  try {
    patch = parseItemPayload((body as { patch?: unknown }).patch ?? {}, "patch");
  } catch (err) {
    return errorResponse(err);
  }

  let count = 0;
  const errors: { id: string; error: string }[] = [];
  for (const id of parsed.ids) {
    try {
      await updateItem(owner.id, asUuid(id, "id"), patch);
      count += 1;
    } catch (err) {
      if (err instanceof ItemError) {
        errors.push({ id, error: err.message });
      } else {
        const correlationId = crypto.randomUUID();
        await captureError("items-batch", err, { correlationId, detail: { id } });
        errors.push({ id, error: `internal error (correlationId ${correlationId})` });
      }
    }
  }

  return NextResponse.json({ count, errors }, { status: count > 0 ? 200 : 400 });
}

// DELETE /api/items/batch — soft-delete many to Trash (each cascades to its live
// children, exactly like DELETE /api/items/:id). Body: { ids: string[] }.
// Response: { count, errors: [{ id, error }] }.
export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = parseIds(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.ids.length === 0) {
    return NextResponse.json({ count: 0, errors: [] });
  }

  let count = 0;
  const errors: { id: string; error: string }[] = [];
  for (const id of parsed.ids) {
    try {
      await softDeleteItem(owner.id, asUuid(id, "id"));
      count += 1;
    } catch (err) {
      if (err instanceof ItemError) {
        errors.push({ id, error: err.message });
      } else {
        const correlationId = crypto.randomUUID();
        await captureError("items-batch", err, { correlationId, detail: { id } });
        errors.push({ id, error: `internal error (correlationId ${correlationId})` });
      }
    }
  }

  return NextResponse.json({ count, errors }, { status: count > 0 ? 200 : 400 });
}
