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
  propertyFilterOptions,
  propertyFiltersFromParams,
  PROPERTY_FILTER_NONE,
} = await import("../src/lib/views");
const { ItemError } = await import("../src/lib/items");
const { boardDropPatch, NONE_GROUP } = await import("../src/lib/view-grouping");
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
  // Statuses are user-defined keys now (S2): the filter accepts any key (it
  // simply matches nothing if no such status exists); the CATEGORY filter is
  // what's validated against the fixed bucket set.
  check(
    "accepts any status key (S2)",
    parseViewInput({ name: "x", layout: "list", filter: { status: "anything" } }).filter
      .status === "anything"
  );
  await throws("rejects bad statusCategory", () =>
    parseViewInput({ name: "x", layout: "list", filter: { statusCategory: "nope" } }), "bad_request");
  await throws("rejects non-uuid relatedTo", () =>
    parseViewInput({ name: "x", layout: "list", filter: { relatedTo: "abc" } }), "bad_request");

  const calendarDef = parseViewInput({ name: "Cal", layout: "calendar", filter: {} });
  check("calendar defaults dateProperty to plan (ADR-109)", calendarDef.dateProperty === "plan");
  const mtgCal = parseViewInput({ name: "Mtg cal", layout: "calendar", filter: { type: "event" } });
  check("meeting calendar defaults dateProperty to meetingAt", mtgCal.dateProperty === "meetingAt");
  check("accepts plan dateField", parseViewInput({ name: "x", layout: "list", filter: { dateField: "plan" } }).filter.dateField === "plan");
  check("accepts plan sort", parseViewInput({ name: "x", layout: "list", sort: { field: "plan", dir: "asc" } }).sort.field === "plan");
  check("accepts plan grouping", (() => { const g = parseViewInput({ name: "x", layout: "board", grouping: { field: "plan" } }).grouping; return !!g && "field" in g && g.field === "plan"; })());

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
  check(
    "parses field grouping",
    !!groupedDef.grouping &&
      "field" in groupedDef.grouping &&
      groupedDef.grouping.field === "status"
  );
  await throws("rejects bad grouping field", () =>
    parseViewInput({ name: "x", layout: "board", grouping: { field: "color" } }), "bad_request");
  // Property grouping (slice 35): a board can group by a custom select field.
  const propGroup = parseViewInput({
    name: "Pipeline",
    layout: "board",
    grouping: { propertyKey: "stage" },
  });
  check(
    "parses property grouping",
    !!propGroup.grouping &&
      "propertyKey" in propGroup.grouping &&
      propGroup.grouping.propertyKey === "stage"
  );

  // Columns (Brandon feedback, 2026-06-14): field + property selectors, with
  // malformed entries dropped, dupes collapsed, order preserved, empty → null.
  check("columns default to null when absent", parseViewInput({ name: "x", layout: "list" }).columns === null);
  const cols = parseViewInput({
    name: "x",
    layout: "table",
    columns: [
      { source: "field", key: "status" },
      { source: "property", key: "stage" },
      { source: "field", key: "status" },   // dupe → dropped
      { source: "field", key: "bogus" },      // unknown field → dropped
      { source: "property", key: "" },         // empty key → dropped
      { source: "weird", key: "status" },      // bad source → dropped
      "garbage",                                // non-object → dropped
    ],
  }).columns;
  check(
    "columns: keeps valid, drops malformed/dupes, preserves order",
    JSON.stringify(cols) ===
      JSON.stringify([
        { source: "field", key: "status" },
        { source: "property", key: "stage" },
      ])
  );
  check("columns: all-invalid collapses to null", parseViewInput({ name: "x", layout: "list", columns: [{ source: "field", key: "nope" }] }).columns === null);
  await throws("rejects non-array columns", () =>
    parseViewInput({ name: "x", layout: "list", columns: { source: "field", key: "status" } }), "bad_request");
  await throws("rejects blank propertyKey grouping", () =>
    parseViewInput({ name: "x", layout: "board", grouping: { propertyKey: "   " } }), "bad_request");

  // Property filters (the filter counterpart to grouping): an array of
  // {key, value}, value null = "not set". Malformed dropped, deduped by key.
  const pf = parseViewInput({
    name: "x",
    layout: "list",
    filter: {
      type: "paper",
      propertyFilters: [
        { key: "stage", value: "drafting" },
        { key: "role", value: null },
        { key: "stage", value: "review" }, // dupe key → dropped
        { key: "", value: "x" },            // empty key → dropped
        "garbage",                          // non-object → dropped
      ],
    },
  }).filter.propertyFilters;
  check(
    "propertyFilters: keeps valid, dedupes by key, drops malformed",
    JSON.stringify(pf) ===
      JSON.stringify([
        { key: "stage", value: "drafting" },
        { key: "role", value: null },
      ])
  );
  await throws("rejects non-array propertyFilters", () =>
    parseViewInput({ name: "x", layout: "list", filter: { propertyFilters: { key: "stage" } } }), "bad_request");

  // The list-bar helpers: offer only select/multi_select; map params + the
  // not-set sentinel; ignore other kinds and unknown keys.
  const fpSchema = [
    { key: "stage", label: "Stage", kind: "select", options: ["drafting", "review"] },
    { key: "tags", label: "Tags", kind: "multi_select", options: ["x", "y"] },
    { key: "note", label: "Note", kind: "text" },
  ];
  check(
    "propertyFilterOptions keeps only select/multi_select",
    JSON.stringify(propertyFilterOptions(fpSchema).map((o) => o.key)) ===
      JSON.stringify(["stage", "tags"])
  );
  check(
    "propertyFiltersFromParams maps params + sentinel, ignores text + unknown",
    JSON.stringify(
      propertyFiltersFromParams(
        { prop_stage: "drafting", prop_tags: PROPERTY_FILTER_NONE, prop_note: "hi", prop_bogus: "z" },
        fpSchema
      )
    ) ===
      JSON.stringify([
        { key: "stage", value: "drafting" },
        { key: "tags", value: null },
      ])
  );

  // Board DnD: the drop→PATCH mapping (status/urgency field, single-select
  // property); computed `due` and `type` groupings aren't draggable (null).
  check(
    "board drop: status field → {status}",
    JSON.stringify(boardDropPatch({ field: "status" }, "done")) ===
      JSON.stringify({ status: "done" })
  );
  check(
    "board drop: urgency 'none' clears urgency",
    JSON.stringify(boardDropPatch({ field: "urgency" }, NONE_GROUP)) ===
      JSON.stringify({ urgency: null })
  );
  check(
    "board drop: property → {propertyPatch}",
    JSON.stringify(boardDropPatch({ propertyKey: "stage" }, "drafting")) ===
      JSON.stringify({ propertyPatch: { stage: "drafting" } })
  );
  check(
    "board drop: property 'none' clears the key",
    JSON.stringify(boardDropPatch({ propertyKey: "stage" }, NONE_GROUP)) ===
      JSON.stringify({ propertyPatch: { stage: null } })
  );
  check("board drop: due grouping isn't draggable", boardDropPatch({ field: "due" }, "today") === null);
  check("board drop: plan grouping isn't draggable", boardDropPatch({ field: "plan" }, "today") === null);
  check("board drop: type grouping isn't draggable", boardDropPatch({ field: "type" }, "task") === null);

  // --- store CRUD ---
  const created = await createView(ownerId, parseViewInput({
    name: "My tasks",
    layout: "table",
    filter: { type: "task", status: "open" },
    sort: { field: "dueDate", dir: "asc" },
    columns: [
      { source: "field", key: "status" },
      { source: "field", key: "dueDate" },
    ],
  }));
  check("createView returns a row", !!created.id && created.name === "My tasks");
  check("createView stored filter", created.filter.type === "task");
  check("createView stored sort", created.sort.field === "dueDate" && created.sort.dir === "asc");
  check("createView stored columns", JSON.stringify(created.columns) === JSON.stringify([{ source: "field", key: "status" }, { source: "field", key: "dueDate" }]));
  check("getView round-trips columns", JSON.stringify((await getView(ownerId, created.id)).columns) === JSON.stringify(created.columns));

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
  check(
    "updateView changes grouping",
    !!updated.grouping &&
      "field" in updated.grouping &&
      updated.grouping.field === "urgency"
  );
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
    (await db.insert(items).values({ ownerId, type: "event", title, meetingAt }).returning({ id: items.id }))[0].id;
  const mToday = await mk("m today", now);
  const m3 = await mk("m +3d", plus(3));
  const m20 = await mk("m +20d", plus(20));

  const onWhen = (over: Record<string, unknown>) =>
    queryViewItems(ownerId, { type: "event", dateField: "meetingAt", ...over });

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
  const onDue = await queryViewItems(ownerId, { type: "event", due: "today", dateField: "dueDate" });
  check("dueDate=today misses meetings (no due date)", !has(onDue, mToday));

  // --- effective plan date (ADR-109): scheduled-primary, due-secondary -------
  const { todayBounds } = await import("../src/lib/today");
  const { dueToday } = todayBounds();
  const dayUtc = (n: number) => new Date(dueToday.getTime() + n * 86400000);
  const mkTask = async (
    title: string,
    dates: { scheduledDate?: Date; dueDate?: Date }
  ) =>
    (await db.insert(items).values({ ownerId, type: "task", title, ...dates }).returning({ id: items.id }))[0].id;
  // A: scheduled in the past, no due → overdue by plan.
  const tSchedPast = await mkTask("sched past", { scheduledDate: dayUtc(-1) });
  // B: scheduled in the FUTURE but due in the past → NOT overdue (scheduled wins).
  const tSchedFutureDuePast = await mkTask("sched future, due past", { scheduledDate: dayUtc(2), dueDate: dayUtc(-1) });
  // C: due today, no scheduled → today by plan (falls back to due).
  const tDueTodayOnly = await mkTask("due today only", { dueDate: dueToday });
  // D: scheduled today → today by plan.
  const tSchedToday = await mkTask("sched today", { scheduledDate: dueToday });

  // No dateField → plan is the default (the straggler fix).
  const planOverdue = await queryViewItems(ownerId, { type: "task", due: "overdue" });
  check("plan overdue: scheduled-past task is overdue", has(planOverdue, tSchedPast));
  check(
    "plan overdue: future-scheduled (past-due) task is NOT overdue — scheduled wins",
    !has(planOverdue, tSchedFutureDuePast)
  );
  check(
    "plan overdue: excludes today/future tasks",
    !has(planOverdue, tDueTodayOnly) && !has(planOverdue, tSchedToday)
  );

  const planToday = await queryViewItems(ownerId, { type: "task", due: "today" });
  check(
    "plan today: due-only-today and scheduled-today both land today",
    has(planToday, tDueTodayOnly) && has(planToday, tSchedToday)
  );
  check("plan today: excludes the overdue task", !has(planToday, tSchedPast));

  // The contrast: filtering by dueDate alone still flags B as overdue (its
  // deadline IS past) — proving plan changed the default, not the column.
  const dueOverdue = await queryViewItems(ownerId, { type: "task", due: "overdue", dateField: "dueDate" });
  check("dueDate overdue still flags the past-due task", has(dueOverdue, tSchedFutureDuePast));

  // Sort by plan orders by the effective date (scheduled ?? due), nulls last.
  const planSorted = await queryViewItems(ownerId, { type: "task" }, { field: "plan", dir: "asc" });
  const idx = (id: string) => planSorted.findIndex((r) => r.id === id);
  check(
    "sort by plan: scheduled-past (−1) precedes today precedes future (+2)",
    idx(tSchedPast) < idx(tDueTodayOnly) && idx(tDueTodayOnly) < idx(tSchedFutureDuePast)
  );
  const planSql = viewItemsQuery(ownerId, { type: "task", due: "overdue" }).toSQL();
  check("plan window targets coalesce(scheduled_date, due_date)", /coalesce/i.test(planSql.sql));

  // --- property filtering: scalar select, multi_select element, "not set" ---
  const mkProp = async (title: string, properties: Record<string, unknown>) =>
    (
      await db
        .insert(items)
        .values({ ownerId, type: "task", title, properties })
        .returning({ id: items.id })
    )[0].id;
  const pDraft = await mkProp("p drafting", { stage: "drafting" });
  const pReview = await mkProp("p review", { stage: "review" });
  const pNone = await mkProp("p none", {});
  const pTags = await mkProp("p tags", { tags: ["x", "y"] });

  const byProp = (filters: { key: string; value: string | null }[]) =>
    queryViewItems(ownerId, { type: "task", propertyFilters: filters });

  const draftOnly = await byProp([{ key: "stage", value: "drafting" }]);
  check(
    "propertyFilter scalar select matches exactly",
    has(draftOnly, pDraft) && !has(draftOnly, pReview) && !has(draftOnly, pNone)
  );
  const tagX = await byProp([{ key: "tags", value: "x" }]);
  check("propertyFilter matches a multi_select element", has(tagX, pTags));
  const tagZ = await byProp([{ key: "tags", value: "z" }]);
  check("propertyFilter excludes a missing multi_select element", !has(tagZ, pTags));
  const stageUnset = await byProp([{ key: "stage", value: null }]);
  check(
    "propertyFilter null = not set",
    has(stageUnset, pNone) &&
      has(stageUnset, pTags) &&
      !has(stageUnset, pDraft) &&
      !has(stageUnset, pReview)
  );
  const propSql = viewItemsQuery(ownerId, {
    type: "task",
    propertyFilters: [{ key: "stage", value: "drafting" }],
  }).toSQL();
  check("property filter targets properties column", propSql.sql.includes("properties"));

  // --- focusedToday (S6, ADR-086): items day-stamped into today's focus ---
  const { appTodayYmd } = await import("../src/lib/recurrence-service");
  const { addDaysYmd } = await import("../src/lib/recurrence");
  const todayY = appTodayYmd();
  const fToday = await mkProp("focus today", { focus: { date: todayY, order: 1 } });
  const fYesterday = await mkProp("focus yesterday", { focus: { date: addDaysYmd(todayY, -1) } });
  const focused = await queryViewItems(ownerId, { type: "task", focusedToday: true });
  check(
    "focusedToday returns today's focus, excludes other days",
    has(focused, fToday) && !has(focused, fYesterday)
  );
  check(
    "focusedToday parses",
    parseViewInput({ name: "x", layout: "list", filter: { focusedToday: true } }).filter
      .focusedToday === true
  );

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
