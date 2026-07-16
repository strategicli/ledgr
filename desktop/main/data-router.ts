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
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  parseDashboardInput,
  updateDashboard,
} from "@/lib/dashboards";
import { resolveDashboard } from "@/lib/dashboard-resolve";
import { getType, listTypes, createType, parseTypeInput } from "@/lib/types";
import { listRelatedItems } from "@/lib/relations";
import { getView, listViews, queryViewItems, createView, parseViewInput } from "@/lib/views";
import {
  createItem,
  updateItem,
  softDeleteItem,
  toggleItemDone,
  restoreItem,
} from "@/lib/item-mutations";
import { parseItemPayload } from "@/lib/item-input";
import { runExport, getExportState } from "@/lib/export/engine";
import { LocalExportTarget } from "@/lib/export/local";

export type DataRequest = { method: string; path: string; body?: unknown };
export type DataResponse = { ok: boolean; status: number; data: unknown };

// The on-disk markdown vault directory (the Obsidian/Claude-readable folder).
// main/index.ts resolves the real path at boot and calls configureExport; until
// then the export endpoints report unconfigured rather than writing nowhere.
let vaultDir: string | null = null;
export function configureExport(dir: string): void {
  vaultDir = dir;
}
export function getVaultDir(): string | null {
  return vaultDir;
}

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

    // Markdown vault export (the local ExportTarget seam — CLAUDE.md Phase 4).
    // POST runs an incremental export into ~/LedgrVault; GET reports last-run
    // state + the vault path. Cloud exports to OneDrive; desktop to disk.
    if (path === "/api/export") {
      if (method === "GET") {
        return ok({ vaultDir, state: await getExportState() });
      }
      if (method === "POST") {
        if (!vaultDir) {
          return { ok: false, status: 503, data: { error: "vault directory not configured" } };
        }
        const result = await runExport(ownerId, new LocalExportTarget(vaultDir));
        return ok({ vaultDir, result });
      }
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
    if (method === "POST" && path === "/api/dashboards") {
      const dashboard = await createDashboard(ownerId, parseDashboardInput(req.body));
      return { ok: true, status: 201, data: { dashboard } };
    }
    // /api/dashboards/:id/resolved — the full per-widget fan-out for rendering
    // (desktop read grid). Shares resolveDashboard with the cloud DashboardView.
    const resolvedId = path.match(/^\/api\/dashboards\/([^/]+)\/resolved$/)?.[1];
    if (method === "GET" && resolvedId) {
      return ok(await resolveDashboard(ownerId, resolvedId));
    }
    // /api/dashboards/:id — GET raw · PATCH replace · DELETE.
    const dashId = path.match(/^\/api\/dashboards\/([^/]+)$/)?.[1];
    if (dashId) {
      if (method === "GET") return ok({ dashboard: await getDashboard(ownerId, dashId) });
      if (method === "PATCH") {
        return ok({ dashboard: await updateDashboard(ownerId, dashId, parseDashboardInput(req.body)) });
      }
      if (method === "DELETE") {
        await deleteDashboard(ownerId, dashId);
        return ok({ ok: true });
      }
    }

    if (method === "GET" && path === "/api/types") {
      return ok({ types: await listTypes() });
    }
    if (method === "POST" && path === "/api/types") {
      const type = await createType(parseTypeInput(req.body, "create"));
      return { ok: true, status: 201, data: { type } };
    }
    const typeKey = path.match(/^\/api\/types\/([^/]+)$/)?.[1];
    if (method === "GET" && typeKey) {
      return ok({ type: await getType(typeKey) });
    }

    if (method === "GET" && path === "/api/views") {
      return ok({ views: await listViews(ownerId) });
    }
    if (method === "POST" && path === "/api/views") {
      const view = await createView(ownerId, parseViewInput(req.body));
      return { ok: true, status: 201, data: { view } };
    }
    // /api/views/:id/items — run the view (getView → queryViewItems).
    const viewItemsId = path.match(/^\/api\/views\/([^/]+)\/items$/)?.[1];
    if (method === "GET" && viewItemsId) {
      const view = await getView(ownerId, viewItemsId);
      return ok({ items: await queryViewItems(ownerId, view.filter, view.sort, 200) });
    }
    const viewId = path.match(/^\/api\/views\/([^/]+)$/)?.[1];
    if (method === "GET" && viewId) {
      return ok({ view: await getView(ownerId, viewId) });
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

    // /api/items/:id/related — items linked to this one ("Linked here").
    const relatedId = path.match(/^\/api\/items\/([^/]+)\/related$/)?.[1];
    if (method === "GET" && relatedId) {
      return ok({ items: await listRelatedItems(ownerId, relatedId) });
    }

    // /api/items/:id/complete — recurrence-aware done toggle.
    const completeId = path.match(/^\/api\/items\/([^/]+)\/complete$/)?.[1];
    if (method === "POST" && completeId) {
      return ok({ item: await toggleItemDone(ownerId, completeId) });
    }

    // /api/items/:id/restore — bring a trashed item (+ its children) back.
    const restoreId = path.match(/^\/api\/items\/([^/]+)\/restore$/)?.[1];
    if (method === "POST" && restoreId) {
      return ok(await restoreItem(ownerId, restoreId));
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
