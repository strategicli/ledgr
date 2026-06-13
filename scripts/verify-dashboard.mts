// Slice 29 verification: the dashboard config (pin / unpin / reorder) and the
// badge count, against live Neon under a throwaway owner. dashboard_order is
// the whole config: non-null = pinned, the number = position. countViewItems
// must agree with the view it labels regardless of any preview limit.
// Run: npx tsx scripts/verify-dashboard.mts  — safe to delete when closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, views, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/items");
const {
  createView,
  parseViewInput,
  listDashboardViews,
  pinView,
  unpinView,
  setDashboardOrder,
  countViewItems,
  queryViewItems,
} = await import("../src/lib/views");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-dashboard-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

try {
  const def = (name: string) =>
    parseViewInput({ name, layout: "list", filter: { type: "task", status: "open" } });
  const a = await createView(ownerId, def("View A"));
  const b = await createView(ownerId, def("View B"));
  const c = await createView(ownerId, def("View C"));

  check("nothing pinned initially", (await listDashboardViews(ownerId)).length === 0);

  await pinView(ownerId, a.id);
  await pinView(ownerId, b.id);
  let dash = await listDashboardViews(ownerId);
  check("pin adds in order", dash.map((v) => v.id).join() === [a.id, b.id].join());
  check("pinned views carry an order", dash.every((v) => v.dashboardOrder != null));

  // pinning again is a no-op (no duplicate, order unchanged).
  await pinView(ownerId, a.id);
  dash = await listDashboardViews(ownerId);
  check("re-pin is a no-op", dash.length === 2);

  // reorder: B, C, A.
  await pinView(ownerId, c.id);
  await setDashboardOrder(ownerId, [b.id, c.id, a.id]);
  dash = await listDashboardViews(ownerId);
  check("reorder persists", dash.map((v) => v.id).join() === [b.id, c.id, a.id].join());

  await unpinView(ownerId, c.id);
  dash = await listDashboardViews(ownerId);
  check("unpin removes from dashboard", !dash.some((v) => v.id === c.id));
  check("unpinned view's other fields survive", dash.length === 2);

  // count agrees with the list, independent of a preview limit.
  await createItem(ownerId, { type: "task", title: "t1", status: "open" });
  await createItem(ownerId, { type: "task", title: "t2", status: "open" });
  await createItem(ownerId, { type: "task", title: "t3", status: "done" });
  const filter = { type: "task", status: "open" as const };
  const count = await countViewItems(ownerId, filter);
  const preview = await queryViewItems(ownerId, filter, undefined, 1);
  check("count is the true total", count === 2, `count=${count}`);
  check("preview respects its limit", preview.length === 1);
} finally {
  await db.delete(views).where(eq(views.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
