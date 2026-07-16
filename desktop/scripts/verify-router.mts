// Headless verification of the desktop data path WITHOUT Electron: init embedded
// PGlite, apply the real migrations, seed an owner + item via @/lib, then drive
// the same dispatchDataRequest() the IPC handler calls. Proves window → (IPC) →
// @/lib → PGlite at the router level. Run: npm run verify:router  (from desktop/).
import { randomUUID } from "node:crypto";
import { initLocalDb } from "@/db";
import { users, types } from "@/db/schema";
import { createItem } from "@/lib/item-mutations";
import { dispatchDataRequest } from "../main/data-router";

process.env.LEDGR_DB_DRIVER = "pglite";

const db = await initLocalDb({
  dataDir: "memory://router-verify",
  migrationsFolder: "./drizzle",
});

const [owner] = await db
  .insert(users)
  .values({ email: `router-${randomUUID()}@example.org` })
  .returning();
await db.insert(types).values({ key: "note", label: "Note" }).onConflictDoNothing();
await createItem(owner.id, { type: "note", title: "Router proof note" });

const settings = await dispatchDataRequest({ method: "GET", path: "/api/settings" }, owner.id);
const items = await dispatchDataRequest(
  { method: "GET", path: "/api/items?type=note&limit=50" },
  owner.id
);
const search = await dispatchDataRequest(
  { method: "GET", path: "/api/search?q=proof" },
  owner.id
);
const dashboards = await dispatchDataRequest(
  { method: "GET", path: "/api/dashboards" },
  owner.id
);

// Write round-trip through the router: create → read → patch → delete.
const created = await dispatchDataRequest(
  { method: "POST", path: "/api/items", body: { type: "note", title: "Router write test" } },
  owner.id
);
const newId = (created.data as { item?: { id?: string } }).item?.id ?? "";
const readOne = await dispatchDataRequest({ method: "GET", path: `/api/items/${newId}` }, owner.id);
const patched = await dispatchDataRequest(
  { method: "PATCH", path: `/api/items/${newId}`, body: { title: "Router write test (edited)" } },
  owner.id
);
const completed = await dispatchDataRequest(
  { method: "POST", path: `/api/items/${newId}/complete` },
  owner.id
);
const deleted = await dispatchDataRequest({ method: "DELETE", path: `/api/items/${newId}` }, owner.id);

const unknown = await dispatchDataRequest({ method: "GET", path: "/api/nope" }, owner.id);

const data = items.data as { items?: unknown[] };
console.log("\n================ desktop data-router PROOF ================");
console.log(
  JSON.stringify(
    {
      settings: {
        ok: settings.ok,
        status: settings.status,
        hasSettings: !!(settings.data as { settings?: unknown }).settings,
      },
      items: { ok: items.ok, status: items.status, count: (data.items ?? []).length },
      search: {
        ok: search.ok,
        status: search.status,
        hits: ((search.data as { items?: unknown[] }).items ?? []).length,
      },
      dashboards: {
        ok: dashboards.ok,
        status: dashboards.status,
        count: ((dashboards.data as { dashboards?: unknown[] }).dashboards ?? []).length,
      },
      write_roundtrip: {
        create: { ok: created.ok, status: created.status, id: !!newId },
        read: { ok: readOne.ok, status: readOne.status },
        patch: {
          ok: patched.ok,
          title: (patched.data as { item?: { title?: string } }).item?.title,
        },
        complete: {
          ok: completed.ok,
          category: (completed.data as { item?: { statusCategory?: string } }).item
            ?.statusCategory,
        },
        delete: { ok: deleted.ok, status: deleted.status },
      },
      unknown_route: { ok: unknown.ok, status: unknown.status },
    },
    null,
    2
  )
);
