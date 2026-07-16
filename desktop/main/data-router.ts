// The desktop equivalent of the Next `/api/*` route handlers: dispatch a
// request descriptor (method/path/body) to the same `@/lib` functions the
// routes wrap, returning the identical JSON shape. This is what the IPC handler
// calls; the `/api/*` REST surface stays the shared contract with the cloud
// build (ADR-139). Owner is the resolved local single owner (no request/cookies).
//
// Coverage here is the proof set (GET /api/settings, GET /api/items). The rest
// of the ~97 endpoints are the mechanical follow-up — each is a thin wrap of an
// `@/lib` call, exactly like its route.
import { listItems } from "@/lib/items";
import { getSettings } from "@/lib/settings";
import { searchItems } from "@/lib/search";
import { listDashboards } from "@/lib/dashboards";

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

    return { ok: false, status: 404, data: { error: `no handler for ${method} ${path}` } };
  } catch (err) {
    return { ok: false, status: 500, data: { error: (err as Error).message } };
  }
}
