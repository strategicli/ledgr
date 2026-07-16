// The desktop equivalent of the Next `/api/*` route handlers: dispatch a
// request descriptor (method/path/body) to the same `@/lib` functions the
// routes wrap, returning the identical JSON shape. This is what the IPC handler
// calls; the `/api/*` REST surface stays the shared contract with the cloud
// build (ADR-139). Owner is the resolved local single owner (no request/cookies).
//
// Coverage here is the proof set (GET /api/settings, GET /api/items). The rest
// of the ~97 endpoints are the mechanical follow-up — each is a thin wrap of an
// `@/lib` call, exactly like its route.
import { listItems, getItem, getItemVersion } from "@/lib/items";
import { getSettings } from "@/lib/settings";
import { searchItems } from "@/lib/search";
import { listDashboards } from "@/lib/dashboards";
import { getType, listTypes } from "@/lib/types";
import {
  createItem,
  updateItem,
  softDeleteItem,
  toggleItemDone,
} from "@/lib/item-mutations";
import { parseItemPayload } from "@/lib/item-input";

export type DataRequest = { method: string; path: string; body?: unknown };
export type DataResponse = { ok: boolean; status: number; data: unknown };

type ListOpts = NonNullable<Parameters<typeof listItems>[1]>;

function ok(data: unknown): DataResponse {
  return { ok: true, status: 200, data };
}

export async function dispatchDataRequest(
  req: DataRequest,
  ownerId: string
): Promise<DataResponse> {
  const url = new URL(req.path, "http://desktop.local");
  const path = url.pathname;
  const q = url.searchParams;
  const method = req.method.toUpperCase();

  try {
    if (method === "GET" && path === "/api/settings") {
      return ok({ settings: await getSettings(ownerId) });
    }

    if (method === "GET" && path === "/api/items") {
      const opts: ListOpts = {
        type: q.get("type") ?? undefined,
        parentId: q.get("parentId") ?? undefined,
        q: q.get("q") ?? undefined,
        trash: q.get("trash") === "true",
      };
      const inbox = q.get("inbox");
      if (inbox !== null) opts.inbox = inbox === "true";
      const limit = q.get("limit");
      if (limit !== null) opts.limit = Number(limit) || undefined;
      const offset = q.get("offset");
      if (offset !== null) opts.offset = Number(offset) || undefined;
      return ok({ items: await listItems(ownerId, opts) });
    }

    if (method === "GET" && path === "/api/search") {
      const query = (q.get("q") ?? "").trim();
      if (!query) return ok({ items: [] });
      const opts: NonNullable<Parameters<typeof searchItems>[2]> = {
        type: q.get("type") ?? undefined,
      };
      const limit = q.get("limit");
      if (limit !== null) opts.limit = Number(limit) || undefined;
      return ok({ items: await searchItems(ownerId, query, opts) });
    }

    if (method === "GET" && path === "/api/dashboards") {
      return ok({ dashboards: await listDashboards(ownerId) });
    }

    if (method === "GET" && path === "/api/types") {
      return ok({ types: await listTypes() });
    }
    const typeKey = path.match(/^\/api\/types\/([^/]+)$/)?.[1];
    if (method === "GET" && typeKey) {
      return ok({ type: await getType(typeKey) });
    }

    if (method === "POST" && path === "/api/items") {
      const item = await createItem(ownerId, parseItemPayload(req.body, "create"));
      return { ok: true, status: 201, data: { item } };
    }

    // /api/items/:id/version — updated_at only (ADR-134 focus/conflict check).
    const versionId = path.match(/^\/api\/items\/([^/]+)\/version$/)?.[1];
    if (method === "GET" && versionId) {
      const { updatedAt } = await getItemVersion(ownerId, versionId);
      return ok({ updatedAt: updatedAt.toISOString() });
    }

    // /api/items/:id/complete — recurrence-aware done toggle.
    const completeId = path.match(/^\/api\/items\/([^/]+)\/complete$/)?.[1];
    if (method === "POST" && completeId) {
      return ok({ item: await toggleItemDone(ownerId, completeId) });
    }

    // /api/items/:id — GET (read one) · PATCH (update) · DELETE (soft-delete).
    const itemId = path.match(/^\/api\/items\/([^/]+)$/)?.[1];
    if (itemId) {
      if (method === "GET") return ok({ item: await getItem(ownerId, itemId) });
      if (method === "PATCH") {
        return ok({ item: await updateItem(ownerId, itemId, parseItemPayload(req.body, "patch")) });
      }
      if (method === "DELETE") return ok(await softDeleteItem(ownerId, itemId));
    }

    return { ok: false, status: 404, data: { error: `no handler for ${method} ${path}` } };
  } catch (err) {
    // Map the @/lib ItemError code convention to a status (the cloud routes do
    // this via errorResponse in @/lib/api, which we can't import here — it pulls
    // next). Same vocabulary, no dependency.
    const code = (err as { code?: string }).code;
    const status =
      code === "bad_request" ? 400
      : code === "not_found" ? 404
      : code === "conflict" ? 409
      : code === "forbidden" ? 403
      : 500;
    return { ok: false, status, data: { error: (err as Error).message } };
  }
}
