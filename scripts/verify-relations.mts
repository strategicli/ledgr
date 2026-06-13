// Slice 6 verification (next_steps.md): exercises the related-items read
// path (src/lib/relations.ts) against the live Neon DB, then cleans up.
// Run with: npx tsx scripts/verify-relations.mts
// Safe to delete once slice 6 is closed (like verify-items.mts).
import { readFileSync } from "node:fs";

// Minimal .env.local loader (DATABASE_URL only); no dotenv dependency.
// Strips a UTF-8 BOM and CRLF (PowerShell-written files carry both).
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const { ItemError, createItem, softDeleteItem, restoreItem, updateItem } =
  await import("../src/lib/items");
const { listRelatedItems, relatedItemsQuery } = await import(
  "../src/lib/relations"
);
const { makeMarkdownBody } = await import("../src/lib/body");
const { mentionToMarkdown } = await import("../src/lib/editor/mention-markdown");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function expectError(
  name: string,
  code: "not_found" | "bad_request",
  fn: () => Promise<unknown>
) {
  try {
    await fn();
    check(name, false, "no error thrown");
  } catch (err) {
    check(name, err instanceof ItemError && err.code === code, String(err));
  }
}

const db = getDb();
const owners = await db.select({ id: users.id }).from(users);
const ownerId = owners[0].id;
const created: string[] = [];
let tempUserId: string | null = null;

try {
  // 1. The query's SQL: owner-scoped, no body columns, live-only, self-safe.
  const qSql = relatedItemsQuery(ownerId, "00000000-0000-0000-0000-000000000000")
    .toSQL()
    .sql.toLowerCase();
  check("related SQL is owner-scoped", qSql.includes("owner_id"));
  check("related SQL selects no body", !/"body"|body_text/.test(qSql), qSql.slice(0, 120));
  check("related SQL filters deleted", qSql.includes("deleted_at"));

  // 2. Fixture: entity E plus one item of each other type, linked all ways.
  const E = await createItem(ownerId, { type: "entity", title: "Verify Entity", kind: "person" });
  const T = await createItem(ownerId, { type: "task", title: "Verify Task" });
  const N = await createItem(ownerId, { type: "note", title: "Verify Note" });
  const L = await createItem(ownerId, { type: "link", title: "Verify Link", url: "https://example.com" });
  const M = await createItem(ownerId, { type: "meeting", title: "Verify Meeting" });
  created.push(E.id, T.id, N.id, L.id, M.id);

  await db.insert(relations).values([
    { sourceId: T.id, targetId: E.id, role: "related" }, // item -> entity
    { sourceId: T.id, targetId: E.id, role: "tag" }, // second role, same pair
    { sourceId: E.id, targetId: N.id, role: "related" }, // entity -> item
    { sourceId: N.id, targetId: E.id, role: "related" }, // both directions
    { sourceId: L.id, targetId: E.id, role: "related", matchState: "suggested" as const },
    { sourceId: E.id, targetId: E.id, role: "related" }, // self-edge
  ]);

  // 3. Mention path: a body mention (the ledgr:// link, ADR-040) creates an
  // edge that lists here.
  await updateItem(ownerId, M.id, {
    body: makeMarkdownBody(`Prep with ${mentionToMarkdown(E.id, E.title)}.`),
  });

  const related = await listRelatedItems(ownerId, E.id);
  const ids = related.map((r) => r.id);
  check("all four linked items appear", [T.id, N.id, L.id, M.id].every((id) => ids.includes(id)), ids.join(","));
  check("self-edge does not list the entity", !ids.includes(E.id));
  check("no duplicate rows", new Set(ids).size === ids.length);

  const t = related.find((r) => r.id === T.id)!;
  check("multi-role edge dedupes with both roles", t.roles.includes("related") && t.roles.includes("tag"), t.roles.join(","));
  check("both-direction pair appears once", ids.filter((id) => id === N.id).length === 1);
  const l = related.find((r) => r.id === L.id)!;
  check("suggested edge carries its match state", l.matchState === "suggested");
  const m = related.find((r) => r.id === M.id)!;
  check("mention edge lists with role mention", m.roles.includes("mention"), m.roles.join(","));
  check("confirmed rows stay confirmed", t.matchState === "confirmed" && m.matchState === "confirmed");

  // 4. Reverse direction: the entity appears on a related item's list too.
  const fromTask = await listRelatedItems(ownerId, T.id);
  check("backlink direction works (E on T's list)", fromTask.some((r) => r.id === E.id));

  // 5. Soft-deleted items drop out; restore brings them back.
  await softDeleteItem(ownerId, N.id);
  const afterDelete = await listRelatedItems(ownerId, E.id);
  check("trashed item drops off the entity page", !afterDelete.some((r) => r.id === N.id));
  await restoreItem(ownerId, N.id);
  const afterRestore = await listRelatedItems(ownerId, E.id);
  check("restored item returns", afterRestore.some((r) => r.id === N.id));

  // 6. Owner scoping: another owner's item never lists, and another owner
  // cannot read this entity's related items at all.
  const temp = await db
    .insert(users)
    .values({ email: "verify-relations-temp@example.invalid" })
    .returning({ id: users.id });
  tempUserId = temp[0].id;
  const X = await db
    .insert(items)
    .values({ ownerId: tempUserId, type: "task", title: "Other Owner Task" })
    .returning({ id: items.id });
  created.push(X[0].id);
  await db.insert(relations).values({ sourceId: X[0].id, targetId: E.id, role: "related" });
  const scoped = await listRelatedItems(ownerId, E.id);
  check("cross-owner item is excluded", !scoped.some((r) => r.id === X[0].id));
  await expectError("other owner cannot read the entity's related list", "not_found", () =>
    listRelatedItems(tempUserId!, E.id)
  );
  await expectError("unknown anchor 404s", "not_found", () =>
    listRelatedItems(ownerId, "00000000-0000-0000-0000-000000000000")
  );
} finally {
  // Cleanup: hard-delete test items (relations cascade) and the temp user.
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  console.log(`cleanup: removed ${created.length} test items`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
