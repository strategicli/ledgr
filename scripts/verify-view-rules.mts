// ADR-164 verification: sort by any property, filter by any property with
// kind-appropriate operators, and the AND/OR rules layer (filter.where) —
// including relation (tag) any/all/none. Against live Neon under a throwaway
// owner, cleaned up in finally. Run: npx tsx scripts/verify-view-rules.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const { queryViewItems, viewItemsQuery, parseViewInput } = await import("../src/lib/views");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-rules-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

async function mkTask(
  title: string,
  properties: Record<string, unknown>,
  urgency?: number | null
) {
  const [r] = await db
    .insert(items)
    .values({ ownerId, type: "task", title, properties, urgency: urgency ?? null })
    .returning({ id: items.id });
  return r.id;
}
async function mkTag(title: string) {
  const [r] = await db
    .insert(items)
    .values({ ownerId, type: "tag", title })
    .returning({ id: items.id });
  return r.id;
}
async function tag(sourceId: string, tagId: string) {
  // relations are owner-scoped via the items they connect (no owner_id column).
  await db.insert(relations).values({ sourceId, targetId: tagId, role: "tags", matchState: "confirmed" });
}

try {
  console.log("# Sort by any property");
  const s2 = await mkTask("score 2", { score: "2" });
  const s10 = await mkTask("score 10", { score: "10" });
  const s9 = await mkTask("score 9", { score: "9" });
  const sNone = await mkTask("score none", {});
  const numAsc = await queryViewItems(
    ownerId,
    { type: "task", propertyFilters: [] },
    { field: "property", propertyKey: "score", numeric: true, dir: "asc" }
  );
  // Only the four score tasks (filter to those we made): check relative order.
  const order = ids(numAsc).filter((id) => [s2, s9, s10, sNone].includes(id));
  check("numeric property sort asc = 2,9,10,(none last)", order.join(",") === [s2, s9, s10, sNone].join(","), order.join(","));
  const propSortSql = viewItemsQuery(
    ownerId,
    { type: "task" },
    { field: "property", propertyKey: "score", numeric: true, dir: "asc" }
  ).toSQL().sql;
  check("property sort emits numeric cast + nulls last", /::numeric/.test(propSortSql) && /nulls last/i.test(propSortSql));
  check(
    "parseSort accepts a property sort",
    parseViewInput({
      name: "x",
      layout: "list",
      sort: { field: "property", propertyKey: "score", numeric: true, dir: "asc" },
    }).sort.field === "property"
  );

  console.log("\n# Property operators");
  const tAlpha = await mkTask("note alpha", { note: "Hello World", when: "2026-03-15" }, 1);
  const tBeta = await mkTask("note beta", { note: "goodbye", when: "2026-08-01" }, 3);
  const byWhere = (combinator: "and" | "or", conditions: unknown[]) =>
    queryViewItems(ownerId, { type: "task", where: { combinator, conditions } as never });

  const contains = await byWhere("and", [{ subject: "property", key: "note", op: "contains", value: "world" }]);
  check("text contains (case-insensitive)", has(contains, tAlpha) && !has(contains, tBeta));

  const gtDate = await byWhere("and", [{ subject: "property", key: "when", op: "gt", value: "2026-06-01" }]);
  check("date after (text ISO compare)", has(gtDate, tBeta) && !has(gtDate, tAlpha));

  const numGt = await byWhere("and", [{ subject: "property", key: "score", op: "gt", value: "5", numeric: true }]);
  check("number greater-than casts numeric", has(numGt, s9) && has(numGt, s10) && !has(numGt, s2));

  const isSet = await byWhere("and", [{ subject: "property", key: "note", op: "set" }]);
  check("property set = has a value", has(isSet, tAlpha) && !has(isSet, s2));
  const isEmpty = await byWhere("and", [{ subject: "property", key: "note", op: "empty" }]);
  check("property empty = missing/blank", has(isEmpty, s2) && !has(isEmpty, tAlpha));

  console.log("\n# AND vs OR combinator");
  const orRes = await byWhere("or", [
    { subject: "property", key: "note", op: "contains", value: "world" },
    { subject: "property", key: "note", op: "contains", value: "goodbye" },
  ]);
  check("OR matches either", has(orRes, tAlpha) && has(orRes, tBeta));
  const andRes = await byWhere("and", [
    { subject: "property", key: "note", op: "contains", value: "world" },
    { subject: "property", key: "note", op: "contains", value: "goodbye" },
  ]);
  check("AND matches neither (contradiction)", !has(andRes, tAlpha) && !has(andRes, tBeta));

  console.log("\n# Priority + status built-ins");
  const p1or3 = await byWhere("or", [{ subject: "priority", op: "anyOf", values: ["1", "3"] }]);
  check("priority anyOf P1/P3", has(p1or3, tAlpha) && has(p1or3, tBeta) && !has(p1or3, s2));

  console.log("\n# Relation (tag) any / all / none");
  const tagA = await mkTag("Alpha");
  const tagB = await mkTag("Beta");
  const both = await mkTask("has both", {});
  const onlyA = await mkTask("has A", {});
  const neither = await mkTask("has neither", {});
  await tag(both, tagA);
  await tag(both, tagB);
  await tag(onlyA, tagA);

  const anyOf = await byWhere("and", [{ subject: "relation", key: "tags", op: "anyOf", values: [tagA, tagB] }]);
  check("relation anyOf = tagged A or B", has(anyOf, both) && has(anyOf, onlyA) && !has(anyOf, neither));

  const allOf = await byWhere("and", [{ subject: "relation", key: "tags", op: "allOf", values: [tagA, tagB] }]);
  check("relation allOf = tagged A and B", has(allOf, both) && !has(allOf, onlyA) && !has(allOf, neither));

  const noneOf = await byWhere("and", [{ subject: "relation", key: "tags", op: "noneOf", values: [tagA, tagB] }]);
  check("relation noneOf excludes tagged", !has(noneOf, both) && !has(noneOf, onlyA) && has(noneOf, neither));

  const relSet = await byWhere("and", [{ subject: "relation", key: "tags", op: "set" }]);
  check("relation set = has any tag", has(relSet, both) && has(relSet, onlyA) && !has(relSet, neither));
  const relEmpty = await byWhere("and", [{ subject: "relation", key: "tags", op: "empty" }]);
  check("relation empty = untagged", !has(relEmpty, both) && has(relEmpty, neither));

  console.log("\n# Combined: type scope AND (tag A OR tag B), still owner-scoped/body-free");
  const combinedSql = viewItemsQuery(ownerId, {
    type: "task",
    where: { combinator: "or", conditions: [{ subject: "relation", key: "tags", op: "anyOf", values: [tagA] }] } as never,
  }).toSQL().sql;
  check("rules query carries owner_id", combinedSql.includes("owner_id"));
  check("rules query selects no body", !/"body"/.test(combinedSql));

  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
} finally {
  // Clean up: relations, items, then the throwaway user.
  const rows = await db.select({ id: items.id }).from(items).where(eq(items.ownerId, ownerId));
  const allIds = rows.map((r) => r.id);
  if (allIds.length) {
    await db.delete(relations).where(inArray(relations.sourceId, allIds));
    await db.delete(items).where(eq(items.ownerId, ownerId));
  }
  await db.delete(users).where(eq(users.id, ownerId));
}

process.exit(failures ? 1 : 0);
