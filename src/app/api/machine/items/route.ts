import { NextResponse } from "next/server";
import { asUuid, errorResponse, parseItemPayload } from "@/lib/api";
import { verifyApiRequest } from "@/lib/auth/credentials";
import {
  ItemError,
  listItems,
  listItemsWithBodies,
  MAX_BODY_ROWS,
  type ItemStatus,
  type ListOptions,
} from "@/lib/items";
import { createItem, updateItem } from "@/lib/item-mutations";
import {
  applyRelateTo,
  applyTags,
  newTagCache,
  parseRelateTo,
  parseTagNames,
} from "@/lib/tag-resolve";
import { resolveMachineOwner } from "@/lib/machine/owner";
import {
  parseBoolParam,
  unknownParams,
  unknownParamsError,
} from "@/lib/machine/query";
import { captureError, createLogger } from "@/lib/log";
import { STATUS_CATEGORIES, type StatusCategory } from "@/lib/status";

// The external HTTP API (ADR-066): app integrations and crons — e.g. Savor's
// journal-push cron — read items out of and write items into Ledgr with an
// `api`-scoped machine token, no Clerk login. Same door as the other
// /api/machine/* jobs (proxy.ts public set, token IS the credential); acts on
// the single owner (resolveMachineOwner). Every write validates through the
// same parseItemPayload / createItem the in-app POST /api/items uses, so this
// surface can't drift from the app contract or skip owner-scoping.
export const dynamic = "force-dynamic";

// Entries per POST / PATCH request. Was 100; raised to 500 (ADR-266) because
// the surface exists for bulk moves, and a 300-note import that has to be cut
// into four requests is three chances to lose track of which slice landed.
// Each entry is still validated and written on its own, so the ceiling bounds
// one request's work, not the correctness of any entry.
const MAX_BATCH = 500;

// The optional write-time extras every POST / PATCH entry may carry alongside
// the item fields (ADR-266): `tags: ["name", …]` resolves or creates tag items
// by name and writes the `tags` edges, and `relateTo: [{ targetId, role? }]`
// writes edges to items the caller already knows by id — the same field the
// in-app POST /api/items accepts. Both are ADDITIVE on PATCH (existing tags
// and edges stay) and idempotent (an edge that exists is confirmed, not
// duplicated). parseItemPayload ignores keys it doesn't know, so these two
// are pulled off the raw entry here, before the item is written; a malformed
// value fails the whole entry up front rather than leaving a half-tagged row.
type WriteExtras = {
  tags: string[];
  relateTo: ReturnType<typeof parseRelateTo>;
};

function parseWriteExtras(entry: unknown): WriteExtras {
  const e = (entry ?? {}) as Record<string, unknown>;
  return {
    tags: parseTagNames(e.tags),
    relateTo: parseRelateTo(e.relateTo),
  };
}

// Apply the extras to a written item and decorate the response row with what
// happened, only when the caller asked for either — an entry that sent
// neither gets the same row it always did.
async function applyWriteExtras(
  ownerId: string,
  item: { id: string },
  extras: WriteExtras,
  cache: ReturnType<typeof newTagCache>
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...item };
  if (extras.tags.length > 0) {
    out.tags = await applyTags(ownerId, item.id, extras.tags, cache);
  }
  if (extras.relateTo.length > 0) {
    out.relatedTo = await applyRelateTo(ownerId, item.id, extras.relateTo);
  }
  return out;
}

// Every query parameter GET understands. An unknown one is a 400 naming it
// (ADR-262), not a silent ignore: `?id=…` used to be dropped on the floor and
// answer with an unfiltered list, so a typo came back looking like a successful
// read of the wrong item. A read surface that can't say "I didn't do that" is
// worse than one that refuses.
const LIST_PARAMS = new Set([
  "type",
  "id",
  "status",
  "statusCategory",
  "relatedTo",
  "parentId",
  "q",
  "limit",
  "offset",
  "includeBody",
]);

// CORS is open for the same reason /api/machine/capture's is (see the comment
// there): the token IS the credential, there are no cookies to protect, and a
// browser client (Launchpad's task tile) fetches with an Authorization header —
// which triggers a preflight this route must answer.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function cors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, status = 200): NextResponse {
  return cors(NextResponse.json(body, { status }));
}

export function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

// GET /api/machine/items — owner-scoped list. Filters mirror the in-app list:
// ?type= (one key or comma-separated) &status= &statusCategory= (a category or
// "active") &relatedTo=<itemId> (confirmed edge either direction — tasks tagged
// with a tag item / filed under a project item) &parentId= &q= &limit= &offset=,
// plus ?id= (one uuid or comma-separated — read a known set) and
// ?includeBody=true.
//
// includeBody is off by default, so an existing caller's payload is unchanged
// byte for byte (ADR-262). Turned on, each row carries its raw `{ format, text }`
// body — the same object PATCH accepts — so a read result feeds straight back
// into a write with no reshaping, and capped at MAX_BODY_ROWS rows because
// bodies are unbounded text. This is what the surface was missing: it could
// write a body and never read one, which made "copy this content to that item"
// a retyping job for whatever was holding the request, and retyping is how a
// 10,737-character note came back 10,736 characters long with no way to find
// the difference.
//
// An unrecognized parameter is a 400 naming it, never a silent ignore.
export async function GET(request: Request) {
  const identity = await verifyApiRequest(request.headers.get("authorization"));
  if (!identity) {
    return json({ error: "unauthorized" }, 401);
  }

  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    return json({ error: "owner not configured" }, 503);
  }

  try {
    const params = new URL(request.url).searchParams;
    const unknown = unknownParams(params, LIST_PARAMS);
    if (unknown.length > 0) {
      return json({ error: unknownParamsError(unknown, LIST_PARAMS) }, 400);
    }
    // type accepts one key or a comma-separated list (?type=project,seminary
    // — the "everything project-shaped" query, paired with GET
    // /api/machine/types to discover which keys those are).
    const rawType = params.get("type");
    const typeList = rawType
      ? rawType.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const opts: ListOptions = {
      type: typeList.length > 1 ? typeList : typeList[0] ?? undefined,
      parentId: params.get("parentId") ?? undefined,
      q: params.get("q") ?? undefined,
    };
    const status = params.get("status");
    if (status !== null) {
      // A status KEY, not the inherited default set (ADR-243) — see the note in
      // /api/items. Shape-check only; an unknown key matches nothing.
      if (!/^[a-z][a-z0-9_]*$/.test(status) || status.length > 40) {
        return json(
          { error: "status must be a status key (a slug: letters, digits, _)" },
          400
        );
      }
      opts.status = status as ItemStatus;
    }
    const statusCategory = params.get("statusCategory");
    if (statusCategory !== null) {
      const valid =
        statusCategory === "active" ||
        (STATUS_CATEGORIES as readonly string[]).includes(statusCategory);
      if (!valid) {
        return json(
          {
            error: `statusCategory must be "active" or one of: ${STATUS_CATEGORIES.join(", ")}`,
          },
          400
        );
      }
      opts.statusCategory = statusCategory as StatusCategory | "active";
    }
    const relatedTo = params.get("relatedTo");
    if (relatedTo !== null) opts.relatedTo = asUuid(relatedTo, "relatedTo");
    // ?id= names the exact rows to read. Each one is validated as a uuid, so a
    // mistyped id is a 400 rather than a silently empty list.
    const rawIds = params.get("id");
    if (rawIds !== null) {
      const ids = rawIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return json({ error: "id must be a uuid" }, 400);
      opts.ids = ids.map((id, i) => asUuid(id, ids.length > 1 ? `id[${i}]` : "id"));
    }
    const limit = params.get("limit");
    if (limit !== null) opts.limit = Number(limit) || undefined;
    const offset = params.get("offset");
    if (offset !== null) opts.offset = Number(offset) || undefined;

    const rawIncludeBody = params.get("includeBody");
    let includeBody = false;
    if (rawIncludeBody !== null) {
      const parsed = parseBoolParam("includeBody", rawIncludeBody);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      includeBody = parsed.value;
    }
    if (includeBody) {
      // The cap is applied in listItemsWithBodies; say so in the response rather
      // than truncating quietly, so a caller reading 40 bodies knows it got 25.
      const rows = await listItemsWithBodies(ownerId, opts);
      return json({
        items: rows,
        ...(rows.length === MAX_BODY_ROWS
          ? { note: `capped at ${MAX_BODY_ROWS} items when includeBody is on; page with offset` }
          : {}),
      });
    }

    return json({ items: await listItems(ownerId, opts) });
  } catch (err) {
    return cors(await errorResponse(err));
  }
}

// POST /api/machine/items — create one item (a bare item object) or a batch
// ({ items: [...] }, max MAX_BATCH). A batch is the cron shape: push every new
// entry since the last run. A malformed entry is reported in `errors` and
// skipped, never dropping the rest — so one bad journal doesn't fail the whole
// push. Each entry may also carry `tags: ["name", …]` and/or
// `relateTo: [{ targetId, role? }]` (ADR-266); a created row then carries
// `tags: [{ id, title, created }]` / `relatedTo: [{ targetId, role }]` saying
// what was written. Response: { count, created: Item[], errors: [{ index,
// error }] }. Status is 201 if anything was created, 400 if every entry failed.
export async function POST(request: Request) {
  const identity = await verifyApiRequest(request.headers.get("authorization"));
  if (!identity) {
    return json({ error: "unauthorized" }, 401);
  }

  const log = createLogger("machine-items");
  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    log.warn("machine API owner unresolved (set LEDGR_API_OWNER_UPN / ONEDRIVE_EXPORT_UPN)");
    return json({ error: "owner not configured" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const batch = (body as { items?: unknown })?.items;
  const rawItems = Array.isArray(batch) ? batch : [body];
  if (rawItems.length === 0) {
    return json({ count: 0, created: [], errors: [] });
  }
  if (rawItems.length > MAX_BATCH) {
    return json({ error: `too many items (max ${MAX_BATCH} per request)` }, 400);
  }

  const created: unknown[] = [];
  const errors: BatchError[] = [];
  const tagCache = newTagCache();
  for (let i = 0; i < rawItems.length; i++) {
    let item: { id: string } | null = null;
    try {
      const input = parseItemPayload(rawItems[i], "create");
      // Validate the extras BEFORE the create so a bad tag list fails the
      // entry cleanly instead of leaving an untagged item behind an error.
      const extras = parseWriteExtras(rawItems[i]);
      item = await createItem(ownerId, input);
      created.push(await applyWriteExtras(ownerId, item, extras, tagCache));
    } catch (err) {
      const error = await describeBatchError(err, i);
      if (item) {
        // The item exists; only its tags/edges didn't land. Report it as
        // created AND name the failure with the id, so the caller can finish
        // the job (POST /api/machine/relations) instead of creating a twin.
        created.push(item);
        errors.push({ index: i, id: item.id, error: `created, but tagging/relating failed: ${error}` });
      } else {
        errors.push({ index: i, error });
      }
    }
  }

  return json({ count: created.length, created, errors }, created.length > 0 ? 201 : 400);
}

// One entry's failure in a batch response. `id` is present only when the
// item itself was written and a follow-on step (tags, relateTo) failed.
type BatchError = { index: number; id?: string; error: string };

// An ItemError is an expected 4xx outcome and is reported verbatim; anything
// else is captured to error_log (rule 9) and reported by correlation id.
async function describeBatchError(err: unknown, index: number): Promise<string> {
  if (err instanceof ItemError) return err.message;
  const correlationId = crypto.randomUUID();
  await captureError("machine-items", err, { correlationId, detail: { index } });
  return `internal error (correlationId ${correlationId})`;
}

// PATCH /api/machine/items — update one item (a bare { id, ...patch }) or a
// batch ({ items: [{ id, ...patch }] }, max MAX_BATCH). Each entry names its
// target by `id` and carries the same fields POST accepts (title, status,
// parentId, body, properties, …) plus the same optional `tags` / `relateTo`
// extras (ADR-266, additive: existing tags and edges stay). An entry carrying
// only `id` + extras tags or links the item without touching its fields, and
// its row in `updated` is then just { id, tags?, relatedTo? }. Every field
// write is validated through the same
// parseItemPayload + updateItem the in-app PATCH /api/items/:id uses, so this
// surface can't drift from the app contract or skip owner-scoping — and
// parent_id changes still go through assertValidParent (no cycles). Added
// (ADR-113) for the migration's two remaining update passes: the not-done task
// hierarchy re-pull (set parent_id) and the attachment body-ref rewrite. A bad
// entry is reported in `errors` and skipped, never failing the rest. Response:
// { count, updated, errors }; 200 if anything updated, 400 if every entry failed.
export async function PATCH(request: Request) {
  const identity = await verifyApiRequest(request.headers.get("authorization"));
  if (!identity) {
    return json({ error: "unauthorized" }, 401);
  }

  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    return json({ error: "owner not configured" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const batch = (body as { items?: unknown })?.items;
  const rawItems = Array.isArray(batch) ? batch : [body];
  if (rawItems.length === 0) {
    return json({ count: 0, updated: [], errors: [] });
  }
  if (rawItems.length > MAX_BATCH) {
    return json({ error: `too many items (max ${MAX_BATCH} per request)` }, 400);
  }

  const updated: unknown[] = [];
  const errors: BatchError[] = [];
  const tagCache = newTagCache();
  for (let i = 0; i < rawItems.length; i++) {
    let item: { id: string } | null = null;
    try {
      const entry = rawItems[i] as Record<string, unknown>;
      const id = asUuid(entry.id, "id");
      const patch = parseItemPayload(entry, "patch");
      const extras = parseWriteExtras(entry);
      // An entry that carries ONLY tags/relateTo (no item fields) is a valid
      // "tag this existing item" call: skip the field update, which would
      // otherwise refuse an empty patch, and just write the edges. Ownership
      // and liveness are still asserted by relateItems on every edge.
      const hasFields = Object.keys(patch).length > 0;
      const hasExtras = extras.tags.length > 0 || extras.relateTo.length > 0;
      if (!hasFields && !hasExtras) {
        throw new ItemError("bad_request", "nothing to update");
      }
      item = hasFields ? await updateItem(ownerId, id, patch) : { id };
      updated.push(await applyWriteExtras(ownerId, item, extras, tagCache));
    } catch (err) {
      const error = await describeBatchError(err, i);
      if (item) {
        updated.push(item);
        errors.push({ index: i, id: item.id, error: `updated, but tagging/relating failed: ${error}` });
      } else {
        errors.push({ index: i, error });
      }
    }
  }

  return json({ count: updated.length, updated, errors }, updated.length > 0 ? 200 : 400);
}
