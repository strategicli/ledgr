// Slice 27 verification: stored View Definitions — parse/validate, the
// owner-scoped CRUD store, system-view immutability, and that a view's filter
// still runs through the body-free, owner-scoped query. Against live Neon
// under a throwaway owner. Run: npx tsx scripts/verify-views.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, views, users } = await import("../src/db/schema");
const {
  parseViewInput,
  createView,
  getView,
  listViews,
  updateView,
  deleteView,
  queryViewItems,
  viewItemsQuery,
} = await import("../src/lib/views");
const { ItemError } = await import("../src/lib/items");
const { and, eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);
async function throws(name: string, fn: () => Promise<unknown> | unknown, code?: string) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    const ok = err instanceof ItemError && (!code || err.code === code);
    check(name, ok, err instanceof Error ? err.message : String(err));
  }
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-views-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;
const [otherUser] = await db
  .insert(users)
  .values({ email: `verify-views-other-${Date.now()}@example.invalid` })
  .returning({ id: users.id });

try {
  // --- parseViewInput ---
  await throws("rejects missing name", () => parseViewInput({ layout: "list" }), "bad_request");
  await throws("rejects bad layout", () => parseViewInput({ name: "x", layout: "grid" }), "bad_request");
  await throws("rejects bad status", () =>
    parseViewInput({ name: "x", layout: "list", filter: { status: "nope" } }), "bad_request");
  await throws("rejects non-uuid entityId", () =>
    parseViewInput({ name: "x", layout: "list", filter: { entityId: "abc" } }), "bad_request");

  const calendarDef = parseViewInput({ name: "Cal", layout: "calendar", filter: {} });
  check("calendar defaults dateProperty to dueDate", calendarDef.dateProperty === "dueDate");

  const dropped = parseViewInput({
    name: "  Trimmed  ",
    layout: "list",
    filter: { type: "task", status: "open", bogus: "x" },
  });
  check("trims name", dropped.name === "Trimmed");
  check("keeps known filter keys", dropped.filter.type === "task" && dropped.filter.status === "open");
  check("drops unknown filter keys", !("bogus" in dropped.filter));

  const groupedDef = parseViewInput({
    name: "Board",
    layout: "board",
    grouping: { field: "status" },
  });
  check("parses grouping", groupedDef.grouping?.field === "status");
  await throws("rejects bad grouping field", () =>
    parseViewInput({ name: "x", layout: "board", grouping: { field: "color" } }), "bad_request");

  // --- store CRUD ---
  const created = await createView(ownerId, parseViewInput({
    name: "My tasks",
    layout: "table",
    filter: { type: "task", status: "open" },
    sort: { field: "dueDate", dir: "asc" },
  }));
  check("createView returns a row", !!created.id && created.name === "My tasks");
  check("createView stored filter", created.filter.type === "task");
  check("createView stored sort", created.sort.field === "dueDate" && created.sort.dir === "asc");

  const fetched = await getView(ownerId, created.id);
  check("getView round-trips", fetched.id === created.id && fetched.layout === "table");

  const list = await listViews(ownerId);
  check("listViews includes the new view", list.some((v) => v.id === created.id));

  const updated = await updateView(ownerId, created.id, parseViewInput({
    name: "My tasks (week)",
    layout: "board",
    filter: { type: "task", due: "week" },
    grouping: { field: "urgency" },
  }));
  check("updateView changes layout", updated.layout === "board");
  check("updateView changes grouping", updated.grouping?.field === "urgency");
  check("updateView changes filter", updated.filter.due === "week" && !updated.filter.status);

  // --- owner scoping ---
  await throws("getView is owner-scoped", () => getView(otherUser.id, created.id), "not_found");
  await throws("updateView is owner-scoped", () =>
    updateView(otherUser.id, created.id, parseViewInput({ name: "x", layout: "list" })), "not_found");

  // --- system view immutability ---
  const [sysRow] = await db
    .insert(views)
    .values({ ownerId, name: "System", isSystem: true, layout: "list" })
    .returning({ id: views.id });
  await throws("system view can't be edited", () =>
    updateView(ownerId, sysRow.id, parseViewInput({ name: "x", layout: "list" })), "bad_request");
  await throws("system view can't be deleted", () => deleteView(ownerId, sysRow.id), "bad_request");

  // --- delete ---
  await deleteView(ownerId, created.id);
  await throws("deleted view is gone", () => getView(ownerId, created.id), "not_found");

  // --- date filtering: meetings filter by "When", + within-N-days range ---
  await throws("rejects bad dateField", () =>
    parseViewInput({ name: "x", layout: "list", filter: { dateField: "whenever" } }), "bad_request");
  await throws("rejects withinDays out of range", () =>
    parseViewInput({ name: "x", layout: "list", filter: { withinDays: 0 } }), "bad_request");
  const coerced = parseViewInput({ name: "x", layout: "list", filter: { withinDays: "10" } });
  check("withinDays coerces to a number", coerced.filter.withinDays === 10);

  const now = new Date();
  const plus = (d: number) => new Date(now.getTime() + d * 86400000);
  const mk = async (title: string, meetingAt: Date) =>
    (await db.insert(items).values({ ownerId, type: "meeting", title, meetingAt }).returning({ id: items.id }))[0].id;
  const mToday = await mk("m today", now);
  const m3 = await mk("m +3d", plus(3));
  const m20 = await mk("m +20d", plus(20));

  const onWhen = (over: Record<string, unknown>) =>
    queryViewItems(ownerId, { type: "meeting", dateField: "meetingAt", ...over });

  const todayMtgs = await onWhen({ due: "today" });
  check("meetingAt=today includes today's meeting", has(todayMtgs, mToday));
  check("meetingAt=today excludes future meetings", !has(todayMtgs, m3) && !has(todayMtgs, m20));

  const weekMtgs = await onWhen({ due: "week" });
  check("meetingAt=week spans the next 7 days", has(weekMtgs, mToday) && has(weekMtgs, m3));
  check("meetingAt=week excludes day 20", !has(weekMtgs, m20));

  const within14 = await onWhen({ withinDays: 14 });
  check("withinDays=14 includes day 3, excludes day 20", has(within14, m3) && !has(within14, m20));

  // The old behavior (default dueDate field) would miss these meetings — they
  // have no due date — which is exactly the gap this fixes.
  const onDue = await queryViewItems(ownerId, { type: "meeting", due: "today" });
  check("dueDate=today misses meetings (no due date)", !has(onDue, mToday));

  // --- the view query stays body-free + owner-scoped ---
  void queryViewItems;
  const sql = viewItemsQuery(ownerId, { type: "task" }, { field: "updatedAt", dir: "desc" }).toSQL();
  check("view query carries owner_id", sql.sql.includes("owner_id"));
  check("view query selects no body", !/"body"/.test(sql.sql) && !/body_text/.test(sql.sql));
  const whenSql = viewItemsQuery(ownerId, { dateField: "meetingAt", due: "today" }).toSQL();
  check("meetingAt filter targets meeting_at", whenSql.sql.includes("meeting_at"));
} finally {
  // Cleanup: views FK to users, items FK to users; delete children first.
  await db.delete(views).where(eq(views.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(and(eq(users.id, ownerId)));
  await db.delete(users).where(eq(users.id, otherUser.id));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
