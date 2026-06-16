// Dashboards-epoch verification: multiple named dashboards, each a jsonb widget
// array (view/stat/action kinds), per-breakpoint grid layout, dashboard-level
// focus merge, the "used as a widget" derivation, reorder, delete, and owner
// scoping — against live Neon under a throwaway owner.
//   npx tsx scripts/verify-dashboards.mts   — safe to delete when closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { dashboards, items, relations, views, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/items");
const { createView, parseViewInput, countViewItems } = await import("../src/lib/views");
const {
  listDashboards,
  getDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  reorderDashboards,
  addWidget,
  updateWidget,
  parseWidgets,
  applyFocus,
  usedViewIds,
} = await import("../src/lib/dashboards");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-dashboards-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

const cell = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

try {
  const def = (name: string) =>
    parseViewInput({ name, layout: "list", filter: { type: "task", status: "open" } });
  const viewA = await createView(ownerId, def("Tasks A"));
  const viewB = await createView(ownerId, def("Tasks B"));

  // 1. empty state
  check("no dashboards initially", (await listDashboards(ownerId)).length === 0);

  // 2. create
  const home = await createDashboard(ownerId, { name: "Home", focusItemId: null, widgets: [] });
  check("create sets position 0 + empty widgets", home.position === 0 && home.widgets.length === 0);
  const second = await createDashboard(ownerId, { name: "Project", focusItemId: null, widgets: [] });
  check("second dashboard gets next position", second.position === 1);

  // 3. add a widget of each kind, round-trip through the store
  const viewWidget = {
    id: crypto.randomUUID(),
    kind: "view" as const,
    viewId: viewA.id,
    settings: { titleOverride: "Open Tasks", itemLimit: 10, sortOverride: null, renderStyle: "compact" as const },
    layout: { lg: cell(0, 0, 6, 4), sm: cell(0, 0, 1, 4) },
  };
  const statWidget = {
    id: crypto.randomUUID(),
    kind: "stat" as const,
    viewId: viewA.id,
    settings: { label: "Open", metric: "count" as const },
    layout: { lg: cell(6, 0, 2, 2) },
  };
  const actionWidget = {
    id: crypto.randomUUID(),
    kind: "action" as const,
    viewId: null,
    settings: { action: "quick-capture" as const, label: "New Task", icon: null, targetType: "task", templateId: null, href: null },
    layout: { lg: cell(8, 0, 4, 2) },
  };
  await updateDashboard(ownerId, home.id, {
    name: "Home",
    focusItemId: null,
    widgets: [viewWidget, statWidget, actionWidget],
  });
  let got = await getDashboard(ownerId, home.id);
  check("all three widget kinds round-trip", got.widgets.length === 3);
  check("view widget keeps its viewId + settings",
    got.widgets[0].kind === "view" && got.widgets[0].viewId === viewA.id &&
    (got.widgets[0].settings as { itemLimit: number }).itemLimit === 10);
  check("action widget has null viewId", got.widgets[2].kind === "action" && got.widgets[2].viewId === null);

  // text/heading widget: non-data structure, null viewId, heading/body settings
  const textParsed = parseWidgets([
    { kind: "text", settings: { heading: "My Tasks", body: "notes" }, layout: {} },
  ]);
  check(
    "text widget parses with null viewId + heading",
    textParsed.length === 1 &&
      textParsed[0].kind === "text" &&
      textParsed[0].viewId === null &&
      (textParsed[0].settings as { heading: string }).heading === "My Tasks"
  );

  // 4. parser tolerance
  const parsed = parseWidgets([
    viewWidget,
    { kind: "view", viewId: "not-a-uuid", settings: {}, layout: {} }, // bad viewId → dropped
    { kind: "bogus" }, // unknown kind → dropped
    "garbage", // not an object → dropped
    { ...statWidget, id: viewWidget.id }, // duplicate id → dropped
  ]);
  check("parser drops malformed/unknown/dup widgets", parsed.length === 1, `len=${parsed.length}`);

  // 5. settings overrides never mutate the backing view
  await updateWidget(ownerId, home.id, viewWidget.id, {
    settings: { titleOverride: "Renamed", itemLimit: 15, sortOverride: { field: "title", dir: "asc" }, renderStyle: "faithful" },
  });
  const viewAfter = await db.select().from(views).where(eq(views.id, viewA.id));
  const storedSort = viewAfter[0].sort as { field?: string; dir?: string } | null;
  check("backing view's sort is untouched by widget override",
    storedSort?.field === viewA.sort.field && storedSort?.dir === viewA.sort.dir,
    JSON.stringify(storedSort));

  // 6. layout cells round-trip + clamp (w clamped to 12, negatives → 0)
  await updateWidget(ownerId, home.id, viewWidget.id, { layout: { lg: { x: -3, y: 2, w: 99, h: 5 } } });
  got = await getDashboard(ownerId, home.id);
  const lg = got.widgets.find((w) => w.id === viewWidget.id)!.layout.lg!;
  check("layout clamps w≤12 and x≥0", lg.w === 12 && lg.x === 0 && lg.y === 2 && lg.h === 5, JSON.stringify(lg));

  // 7. focus merge
  const person = await createItem(ownerId, { type: "person", title: "Roger" });
  const relatedTask = await createItem(ownerId, { type: "task", title: "1:1 prep", status: "open" });
  await createItem(ownerId, { type: "task", title: "unrelated", status: "open" });
  await db.insert(relations).values({ sourceId: relatedTask.id, targetId: person.id, role: "related", matchState: "confirmed" });
  const baseFilter = { type: "task", status: "open" as const };
  check("applyFocus injects relatedTo", applyFocus(baseFilter, person.id).relatedTo === person.id);
  check("applyFocus leaves a self-pinned relation alone",
    applyFocus({ ...baseFilter, relatedTo: viewA.id }, person.id).relatedTo === viewA.id);
  const focusedCount = await countViewItems(ownerId, applyFocus(baseFilter, person.id));
  const unfocusedCount = await countViewItems(ownerId, baseFilter);
  check("focus narrows the count to related items", focusedCount === 1 && unfocusedCount === 2,
    `focused=${focusedCount} unfocused=${unfocusedCount}`);

  // 8. usedViewIds: A is placed (home + project), B is not
  await addWidget(ownerId, second.id, { ...viewWidget, id: crypto.randomUUID() });
  const used = await usedViewIds(ownerId);
  check("usedViewIds includes placed view, excludes unplaced", used.has(viewA.id) && !used.has(viewB.id));
  check("usedViewIds dedupes across dashboards", used.size === 1, `size=${used.size}`);

  // 9. reorder
  await reorderDashboards(ownerId, [second.id, home.id]);
  const ordered = await listDashboards(ownerId);
  check("reorder persists", ordered.map((d) => d.id).join() === [second.id, home.id].join());

  // 10. delete + focus SET NULL
  const focused = await createDashboard(ownerId, { name: "Focused", focusItemId: person.id, widgets: [] });
  await db.delete(relations).where(eq(relations.targetId, person.id));
  await db.delete(items).where(eq(items.id, person.id)); // hard delete → FK SET NULL fires
  const afterFocusDelete = await getDashboard(ownerId, focused.id);
  check("deleting focus item clears focus, keeps dashboard", afterFocusDelete.focusItemId === null);
  await deleteDashboard(ownerId, second.id);
  check("delete removes the dashboard", !(await listDashboards(ownerId)).some((d) => d.id === second.id));

  // 11. owner scoping
  const [otherUser] = await db
    .insert(users)
    .values({ email: `verify-dashboards-other-${Date.now()}@example.invalid` })
    .returning({ id: users.id });
  let scoped = false;
  try {
    await getDashboard(otherUser.id, home.id);
  } catch {
    scoped = true;
  }
  check("getDashboard is owner-scoped", scoped);
  await db.delete(users).where(eq(users.id, otherUser.id));
} finally {
  await db.delete(dashboards).where(eq(dashboards.ownerId, ownerId));
  await db.delete(views).where(eq(views.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
