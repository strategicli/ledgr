// List paging verification (ADR-116): the plain (sort-lens) list no longer
// silently truncates at one page. The engine renders a window the list pages
// grow via ?show= ("Load more"), clamped to a hard ceiling, while the count
// stays the true total. Pure parse + SQL clamp + a live 205-row window against
// Neon (a throwaway owner, torn down in finally — safe on any DB).
// Run: npx tsx scripts/verify-list-paging.mts
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

const { parseListWindow, VIEW_LIMIT, VIEW_MAX } = await import("../src/lib/views");

console.log("\n# Pure: parseListWindow");
check("default (undefined) = one page", parseListWindow(undefined) === VIEW_LIMIT);
check("floors a sub-page value to one page", parseListWindow("50") === VIEW_LIMIT);
check("passes a valid grown window", parseListWindow("400") === 400);
check("clamps to the ceiling", parseListWindow(String(VIEW_MAX * 10)) === VIEW_MAX);
check("ignores non-numeric junk", parseListWindow("abc") === VIEW_LIMIT);
check("takes the first of a repeated param", parseListWindow(["600", "x"]) === 600);

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { queryViewItems, viewItemsQuery, countViewItems } = await import("../src/lib/views");
const { eq: dEq } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-paging-${stamp}@example.invalid` })
  .returning({ id: users.id });

try {
  console.log("\n# Engine: the LIMIT is clamped to [1, VIEW_MAX]");
  const numParams = (n?: number) =>
    viewItemsQuery(owner.id, { type: "note" }, undefined, n)
      .toSQL()
      .params.filter((p) => typeof p === "number") as number[];
  check("default LIMIT param = VIEW_LIMIT", numParams()[0] === VIEW_LIMIT, `got ${numParams()[0]}`);
  check("a grown window passes through", numParams(400)[0] === 400);
  check("over-ceiling clamps to VIEW_MAX", numParams(VIEW_MAX * 10)[0] === VIEW_MAX);
  const sql = viewItemsQuery(owner.id, { type: "note" }, undefined, 400).toSQL();
  check("still owner-scoped", sql.sql.includes("owner_id"));
  check("still body-free", !sql.sql.includes('"body"'));

  console.log("\n# Live: a 205-row list pages instead of truncating");
  await db.insert(items).values(
    Array.from({ length: 205 }, (_, i) => ({ ownerId: owner.id, type: "note", title: `n${i}` }))
  );
  const page1 = await queryViewItems(owner.id, { type: "note" });
  check("default fetch returns exactly one page", page1.length === VIEW_LIMIT, `got ${page1.length}`);
  const grown = await queryViewItems(owner.id, { type: "note" }, undefined, 400);
  check("grown window returns every row", grown.length === 205, `got ${grown.length}`);
  const count = await countViewItems(owner.id, { type: "note" });
  check("count is the true total, not the window", count === 205, `got ${count}`);
  check("count > one page (the footer has more to offer)", count > page1.length);
} finally {
  await db.delete(items).where(dEq(items.ownerId, owner.id));
  await db.delete(users).where(dEq(users.id, owner.id));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
