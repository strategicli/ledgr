import { NextResponse } from "next/server";
import { asUuid, errorResponse, parseItemPayload } from "@/lib/api";
import { verifyMachineToken } from "@/lib/auth/machine";
import {
  ITEM_STATUSES,
  ItemError,
  createItem,
  listItems,
  updateItem,
  type ItemStatus,
  type ListOptions,
} from "@/lib/items";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { captureError, createLogger } from "@/lib/log";

// The external HTTP API (ADR-066): app integrations and crons — e.g. Savor's
// journal-push cron — read items out of and write items into Ledgr with an
// `api`-scoped machine token, no Clerk login. Same door as the other
// /api/machine/* jobs (proxy.ts public set, token IS the credential); acts on
// the single owner (resolveMachineOwner). Every write validates through the
// same parseItemPayload / createItem the in-app POST /api/items uses, so this
// surface can't drift from the app contract or skip owner-scoping.
export const dynamic = "force-dynamic";

const MAX_BATCH = 100;

// GET /api/machine/items — owner-scoped list, body-free (the "out of this"
// path). Filters mirror the in-app list: ?type= &status= &parentId= &q= &limit=
// &offset=. Open an item's body via the MCP get_item tool if you need it.
export async function GET(request: Request) {
  const identity = verifyMachineToken(request.headers.get("authorization"), "api");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    return NextResponse.json({ error: "owner not configured" }, { status: 503 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const opts: ListOptions = {
      type: params.get("type") ?? undefined,
      parentId: params.get("parentId") ?? undefined,
      q: params.get("q") ?? undefined,
    };
    const status = params.get("status");
    if (status !== null) {
      if (!ITEM_STATUSES.includes(status as ItemStatus)) {
        return NextResponse.json(
          { error: `status must be one of: ${ITEM_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      opts.status = status as ItemStatus;
    }
    const limit = params.get("limit");
    if (limit !== null) opts.limit = Number(limit) || undefined;
    const offset = params.get("offset");
    if (offset !== null) opts.offset = Number(offset) || undefined;

    return NextResponse.json({ items: await listItems(ownerId, opts) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/machine/items — create one item (a bare item object) or a batch
// ({ items: [...] }). A batch is the cron shape: push every new entry since the
// last run. A malformed entry is reported in `errors` and skipped, never
// dropping the rest — so one bad journal doesn't fail the whole push.
// Response: { count, created: Item[], errors: [{ index, error }] }. Status is
// 201 if anything was created, 400 if every entry failed.
export async function POST(request: Request) {
  const identity = verifyMachineToken(request.headers.get("authorization"), "api");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const log = createLogger("machine-items");
  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    log.warn("machine API owner unresolved (set LEDGR_API_OWNER_UPN / ONEDRIVE_EXPORT_UPN)");
    return NextResponse.json({ error: "owner not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const batch = (body as { items?: unknown })?.items;
  const rawItems = Array.isArray(batch) ? batch : [body];
  if (rawItems.length === 0) {
    return NextResponse.json({ count: 0, created: [], errors: [] });
  }
  if (rawItems.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `too many items (max ${MAX_BATCH} per request)` },
      { status: 400 }
    );
  }

  const created: unknown[] = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    try {
      const input = parseItemPayload(rawItems[i], "create");
      created.push(await createItem(ownerId, input));
    } catch (err) {
      if (err instanceof ItemError) {
        errors.push({ index: i, error: err.message });
      } else {
        const correlationId = crypto.randomUUID();
        await captureError("machine-items", err, { correlationId, detail: { index: i } });
        errors.push({ index: i, error: `internal error (correlationId ${correlationId})` });
      }
    }
  }

  return NextResponse.json(
    { count: created.length, created, errors },
    { status: created.length > 0 ? 201 : 400 }
  );
}

// PATCH /api/machine/items — update one item (a bare { id, ...patch }) or a
// batch ({ items: [{ id, ...patch }] }, max 100). Each entry names its target
// by `id` and carries the same fields POST accepts (title, status, parentId,
// body, properties, …); every entry is validated through the same
// parseItemPayload + updateItem the in-app PATCH /api/items/:id uses, so this
// surface can't drift from the app contract or skip owner-scoping — and
// parent_id changes still go through assertValidParent (no cycles). Added
// (ADR-113) for the migration's two remaining update passes: the not-done task
// hierarchy re-pull (set parent_id) and the attachment body-ref rewrite. A bad
// entry is reported in `errors` and skipped, never failing the rest. Response:
// { count, updated, errors }; 200 if anything updated, 400 if every entry failed.
export async function PATCH(request: Request) {
  const identity = verifyMachineToken(request.headers.get("authorization"), "api");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    return NextResponse.json({ error: "owner not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const batch = (body as { items?: unknown })?.items;
  const rawItems = Array.isArray(batch) ? batch : [body];
  if (rawItems.length === 0) {
    return NextResponse.json({ count: 0, updated: [], errors: [] });
  }
  if (rawItems.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `too many items (max ${MAX_BATCH} per request)` },
      { status: 400 }
    );
  }

  const updated: unknown[] = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    try {
      const entry = rawItems[i] as Record<string, unknown>;
      const id = asUuid(entry.id, "id");
      const patch = parseItemPayload(entry, "patch");
      updated.push(await updateItem(ownerId, id, patch));
    } catch (err) {
      if (err instanceof ItemError) {
        errors.push({ index: i, error: err.message });
      } else {
        const correlationId = crypto.randomUUID();
        await captureError("machine-items", err, { correlationId, detail: { index: i } });
        errors.push({ index: i, error: `internal error (correlationId ${correlationId})` });
      }
    }
  }

  return NextResponse.json(
    { count: updated.length, updated, errors },
    { status: updated.length > 0 ? 200 : 400 }
  );
}
