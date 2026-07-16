// Headless verification of the desktop data path WITHOUT Electron: init embedded
// PGlite, apply the real migrations, seed an owner + item via @/lib, then drive
// the same dispatchDataRequest() the IPC handler calls. Proves window → (IPC) →
// @/lib → PGlite at the router level. Run: npm run verify:router  (from desktop/).
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { initLocalDb } from "@/db";
import { users, types } from "@/db/schema";
import { createItem } from "@/lib/item-mutations";
import { dispatchDataRequest } from "../main/data-router";

process.env.LEDGR_DB_DRIVER = "pglite";

const db = await initLocalDb("memory://router-verify");
await migrate(db, { migrationsFolder: "./drizzle" });

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
      unknown_route: { ok: unknown.ok, status: unknown.status },
    },
    null,
    2
  )
);
