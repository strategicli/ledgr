// List-lenses verification: the per-type tab strip (sort + widget/view lenses).
// Pure helpers (list-lenses.ts) + the engine's new sort modes and the view-lens
// resolver against live Neon. Run: npx tsx scripts/verify-list-lenses.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const {
  defaultLenses,
  lensesForType,
  selectLens,
  resolveLensSort,
  parseLenses,
  parseListTabs,
  lensPropertyOptions,
} = await import("../src/lib/list-lenses");
type Lens = import("../src/lib/list-lenses").Lens;

const FAKE_UUID = "11111111-1111-1111-1111-111111111111";

console.log("\n# Pure: defaults + resolve");
const defs = defaultLenses();
check("four default lenses", defs.length === 4, `got ${defs.length}`);
check("default ids", JSON.stringify(defs.map((l) => l.id)) === JSON.stringify(["recent", "newest", "az", "linked"]));
check("first default = recent updatedAt desc", defs[0].kind === "sort" && JSON.stringify(resolveLensSort(defs[0], false)) === JSON.stringify({ field: "updatedAt", dir: "desc" }));
check("most-linked default", defs[3].kind === "sort" && JSON.stringify(resolveLensSort(defs[3], false)) === JSON.stringify({ field: "mostLinked", dir: "desc" }));
check("reverse flips dir", JSON.stringify(resolveLensSort(defs[3], true)) === JSON.stringify({ field: "mostLinked", dir: "asc" }));
const propLens: Lens = { id: "p1", kind: "sort", label: "Rank", source: { property: "rank", numeric: true }, dir: "asc" };
check("property lens → property sort", JSON.stringify(resolveLensSort(propLens, false)) === JSON.stringify({ field: "property", propertyKey: "rank", numeric: true, dir: "asc" }));
check("property lens reverse", resolveLensSort(propLens, true)?.dir === "desc");
const viewLens: Lens = { id: "v1", kind: "view", label: "Board", viewId: FAKE_UUID };
check("view lens has no sort", resolveLensSort(viewLens, false) === null);

console.log("\n# Pure: selectLens + lensesForType");
check("selectLens by id", selectLens(defs, "az").id === "az");
check("selectLens fallback to first", selectLens(defs, "nope").id === "recent");
check("lensesForType defaults when absent", lensesForType({ listTabs: {} }, "task").length === 4);
check("lensesForType uses override", lensesForType({ listTabs: { task: [propLens] } }, "task")[0].id === "p1");
check("lensesForType ignores empty override", lensesForType({ listTabs: { task: [] } }, "task").length === 4);

console.log("\n# Pure: parseLenses / parseListTabs (tolerant)");
check("parseLenses drops malformed (no label)", JSON.stringify(parseLenses([{ id: "x", kind: "sort", source: { field: "title" }, dir: "asc" }])) === "null");
check("parseLenses keeps valid sort", parseLenses([{ id: "x", label: "X", kind: "sort", source: { field: "title" }, dir: "asc" }])?.length === 1);
check("parseLenses dedupes ids", parseLenses([
  { id: "x", label: "A", kind: "sort", source: { field: "title" }, dir: "asc" },
  { id: "x", label: "B", kind: "sort", source: { field: "createdAt" }, dir: "desc" },
])?.length === 1);
check("parseLenses view requires uuid", parseLenses([{ id: "v", label: "V", kind: "view", viewId: "not-a-uuid" }]) === null);
check("parseLenses view valid uuid", parseLenses([{ id: "v", label: "V", kind: "view", viewId: FAKE_UUID }])?.length === 1);
check("parseLenses rejects unknown field", parseLenses([{ id: "z", label: "Z", kind: "sort", source: { field: "bogus" }, dir: "asc" }]) === null);
check("parseLenses caps at 12", (parseLenses(Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, label: `L${i}`, kind: "sort", source: { field: "title" }, dir: "asc" })))?.length ?? 0) === 12);
const lt = parseListTabs({ task: [{ id: "x", label: "X", kind: "sort", source: { field: "title" }, dir: "asc" }], bad: "nope", "": [] });
check("parseListTabs keeps valid type key", !!lt.task && lt.task.length === 1);
check("parseListTabs drops invalid keys/values", !("bad" in lt) && !("" in lt));

console.log("\n# Pure: lensPropertyOptions");
const opts = lensPropertyOptions([
  { key: "rank", label: "Rank", kind: "number" },
  { key: "code", label: "Code", kind: "text" },
  { key: "when", label: "When", kind: "date" },
  { key: "stage", label: "Stage", kind: "select" },
  { key: "tags", label: "Tags", kind: "multi_select" },
  { key: "site", label: "Site", kind: "url" },
]);
check("offers text/number/date/select", JSON.stringify(opts.map((o) => o.key)) === JSON.stringify(["rank", "code", "when", "stage"]));
check("number marked numeric", opts.find((o) => o.key === "rank")?.numeric === true);
check("text not numeric", opts.find((o) => o.key === "code")?.numeric === false);

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, users, relations, views } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/item-mutations");
const { queryViewItems, viewItemsQuery, createView, parseViewInput } = await import("../src/lib/views");
const { resolveViewLens, applyTypeScope } = await import("../src/lib/view-render");
const { getSettings, updateSettings } = await import("../src/lib/settings");
const { eq: dEq, inArray } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-lenses-${stamp}@example.invalid` }).returning({ id: users.id });
const [other] = await db.insert(users).values({ email: `verify-lenses-other-${stamp}@example.invalid` }).returning({ id: users.id });

try {
  console.log("\n# Engine: query is owner-scoped + body-free");
  const sql = viewItemsQuery(owner.id, { type: "task" }, { field: "mostLinked", dir: "desc" }).toSQL();
  check("orders by relation count", /count\(\*\)/i.test(sql.sql) && /match_state/i.test(sql.sql));
  check("owner-scoped", sql.sql.includes("owner_id"));
  check("no body column selected", !sql.sql.includes('"body"'));

  console.log("\n# Engine: mostLinked ordering");
  const hub = await createItem(owner.id, { type: "task", title: "hub (3 links)" });
  const mid = await createItem(owner.id, { type: "task", title: "mid (1 link)" });
  const lonely = await createItem(owner.id, { type: "task", title: "lonely (0)" });
  // Relate hub/mid to NOTE items so the type=task query holds just the 3 tasks.
  const targets = await Promise.all([1, 2, 3].map((n) => createItem(owner.id, { type: "note", title: `t${n}` })));
  await db.insert(relations).values(targets.map((t) => ({ sourceId: hub.id, targetId: t.id })));
  await db.insert(relations).values([{ sourceId: mid.id, targetId: targets[0].id }]);
  // Another owner's heavily-linked task must not leak into this owner's query.
  const otherHub = await createItem(other.id, { type: "task", title: "other hub" });
  const otherT = await createItem(other.id, { type: "note", title: "other t" });
  await db.insert(relations).values([{ sourceId: otherHub.id, targetId: otherT.id }]);

  const desc = await queryViewItems(owner.id, { type: "task" }, { field: "mostLinked", dir: "desc" });
  check("most-linked desc = hub, mid, lonely", JSON.stringify(desc.map((r) => r.id)) === JSON.stringify([hub.id, mid.id, lonely.id]), desc.map((r) => r.title).join(" | "));
  const asc = await queryViewItems(owner.id, { type: "task" }, { field: "mostLinked", dir: "asc" });
  check("most-linked asc = lonely, mid, hub", JSON.stringify(asc.map((r) => r.id)) === JSON.stringify([lonely.id, mid.id, hub.id]));
  check("other owner's task excluded", !desc.some((r) => r.id === otherHub.id));

  console.log("\n# Engine: property sort (text vs numeric guard)");
  const ptag = `lens-${stamp}`;
  const s10 = await createItem(owner.id, { type: "task", title: "score 10", properties: { ptag, score: "10" } });
  const s9 = await createItem(owner.id, { type: "task", title: "score 9", properties: { ptag, score: "9" } });
  const s2 = await createItem(owner.id, { type: "task", title: "score 2", properties: { ptag, score: "2" } });
  await createItem(owner.id, { type: "task", title: "score x", properties: { ptag, score: "x" } });
  await createItem(owner.id, { type: "task", title: "no score", properties: { ptag } });
  const filter = { type: "task", propertyFilters: [{ key: "ptag", value: ptag }] };
  const numAsc = await queryViewItems(owner.id, filter, { field: "property", propertyKey: "score", numeric: true, dir: "asc" });
  check("numeric asc first three = 2,9,10", JSON.stringify(numAsc.slice(0, 3).map((r) => r.id)) === JSON.stringify([s2.id, s9.id, s10.id]), numAsc.map((r) => r.title).join(" | "));
  check("numeric guard pushes non-number last", numAsc.length === 5 && numAsc[3] != null && numAsc[4] != null);
  const txtAsc = await queryViewItems(owner.id, filter, { field: "property", propertyKey: "score", numeric: false, dir: "asc" });
  check("text asc first three = 10,2,9 (lexical)", JSON.stringify(txtAsc.slice(0, 3).map((r) => r.id)) === JSON.stringify([s10.id, s2.id, s9.id]));

  console.log("\n# View lens: applyTypeScope + resolveViewLens");
  check("applyTypeScope sets type when absent", applyTypeScope({}, "task").type === "task");
  check("applyTypeScope keeps pinned type", applyTypeScope({ type: "note" }, "task").type === "note");
  const view = await createView(owner.id, parseViewInput({ name: `Lens View ${stamp}`, layout: "list" }));
  const resolved = await resolveViewLens(owner.id, view.id, "task");
  const allTasks = await queryViewItems(owner.id, { type: "task" });
  check("resolveViewLens returns data", resolved !== null);
  check("view lens scoped to type", resolved?.view.filter.type === "task");
  check("view lens count = this owner's tasks", (resolved?.count ?? -1) === allTasks.length, `count ${resolved?.count} vs ${allTasks.length}`);
  check("view lens items are tasks", (resolved?.items ?? []).every((i) => i.type === "task"));
  const missing = await resolveViewLens(owner.id, FAKE_UUID, "task");
  check("missing view → null (falls back)", missing === null);

  console.log("\n# Settings round-trip");
  await updateSettings(owner.id, { listTabs: { task: [propLens] } });
  const s1 = await getSettings(owner.id);
  check("listTabs persisted", s1.listTabs.task?.[0]?.id === "p1");
  check("listTabs view-lens uuid validated on read", parseLenses([{ id: "v", label: "V", kind: "view", viewId: view.id }])?.length === 1);
  await updateSettings(owner.id, { listTabs: {} });
  const s2v = await getSettings(owner.id);
  check("listTabs reset clears the key", !s2v.listTabs.task);
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o));
    await db.delete(views).where(dEq(views.ownerId, o));
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
