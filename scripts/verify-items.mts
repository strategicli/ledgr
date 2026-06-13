// Slice 4 verification (next_steps.md): exercises the real item CRUD lib
// against the live Neon DB, then cleans up after itself. Run with
//   npx tsx scripts/verify-items.ts
// Safe to delete once slice 4 is closed (like verify-db.mjs).
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
const { items, revisions, users } = await import("../src/db/schema");
const {
  ItemError,
  createItem,
  getItem,
  listItems,
  listItemsQuery,
  listRevisions,
  purgeExpiredTrash,
  restoreItem,
  restoreRevision,
  softDeleteItem,
  updateItem,
} = await import("../src/lib/items");
const { makeMarkdownBody } = await import("../src/lib/body");
const { eq, inArray, sql } = await import("drizzle-orm");


// jsonb round-trips don't preserve key order; compare canonically.
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${k}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

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

// Canonical markdown bodies (ADR-040); body_text/FTS derive from these.
const bodyV1 = makeMarkdownBody("hello slice four");
const bodyV2 = makeMarkdownBody("edited body");

try {
  // 1. The list query's SQL: owner-scoped, no body columns.
  const listSql = listItemsQuery(ownerId, {}).toSQL().sql.toLowerCase();
  check("list SQL is owner-scoped", listSql.includes("owner_id"));
  check("list SQL selects no body", !/"body"|body_text/.test(listSql), listSql.slice(0, 120));

  // 2. Create with body -> body returned, one revision snapshotted.
  const a = await createItem(ownerId, {
    type: "note",
    title: "verify-items A",
    body: bodyV1,
  });
  created.push(a.id);
  check("create returns body", canon(a.body) === canon(bodyV1));
  const revs1 = await listRevisions(ownerId, a.id);
  check("create snapshots one revision", revs1.length === 1);

  // 3. List rows carry no body key; created item present.
  const listed = await listItems(ownerId, { type: "note" });
  const rowA = listed.find((r) => r.id === a.id);
  check("created item appears in list", !!rowA);
  check("list rows have no body key", rowA !== undefined && !("body" in rowA));

  // 4. Body update refreshes body_text and debounces the snapshot.
  const a2 = await updateItem(ownerId, a.id, { body: bodyV2 });
  check("update returns new body", canon(a2.body) === canon(bodyV2));
  const revs2 = await listRevisions(ownerId, a.id);
  check("revision debounced (still 1)", revs2.length === 1);
  const ft = await db.execute(
    sql`select id from items where id = ${a.id} and search @@ plainto_tsquery('english', 'edited')`
  );
  check("body_text feeds tsvector", ft.rows.length === 1);

  // 5. Revision restore: pre-restore body force-snapshotted, body rolled back.
  const a3 = await restoreRevision(ownerId, a.id, revs2[0].id);
  check("revision restore rolls body back", canon(a3.body) === canon(bodyV1));
  const revs3 = await listRevisions(ownerId, a.id);
  check("pre-restore body snapshotted (now 2)", revs3.length === 2);

  // 6. Hierarchy: P -> C -> G; soft-delete P cascades; restore round-trips.
  const p = await createItem(ownerId, { type: "task", title: "verify P" });
  const c = await createItem(ownerId, { type: "task", title: "verify C", parentId: p.id });
  const g = await createItem(ownerId, { type: "task", title: "verify G", parentId: c.id });
  created.push(p.id, c.id, g.id);

  const del = await softDeleteItem(ownerId, p.id);
  check("parent soft-delete cascades (3 deleted)", del.deleted === 3, String(del.deleted));
  const liveAfterDelete = await listItems(ownerId, { type: "task" });
  check("deleted items leave the live list", !liveAfterDelete.some((r) => [p.id, c.id, g.id].includes(r.id)));
  const trash = await listItems(ownerId, { type: "task", trash: true });
  check("trash view shows the unit", [p.id, c.id, g.id].every((id) => trash.some((r) => r.id === id)));

  const res = await restoreItem(ownerId, p.id);
  check("restore round-trips the unit (3)", res.restored === 3, String(res.restored));
  const liveAfterRestore = await listItems(ownerId, { type: "task" });
  check("restored items are live again", [p.id, c.id, g.id].every((id) => liveAfterRestore.some((r) => r.id === id)));

  // 7. Independently deleted child keeps its own trash timestamp.
  await softDeleteItem(ownerId, g.id);
  await new Promise((r) => setTimeout(r, 1100)); // distinct deleted_at
  const del2 = await softDeleteItem(ownerId, p.id);
  check("second delete takes only P and C", del2.deleted === 2, String(del2.deleted));
  const res2 = await restoreItem(ownerId, p.id);
  check("restore skips the earlier-deleted child", res2.restored === 2, String(res2.restored));
  const gRow = await db.select({ deletedAt: items.deletedAt }).from(items).where(eq(items.id, g.id));
  check("G stays in trash", gRow[0].deletedAt !== null);
  await restoreItem(ownerId, g.id);

  // 8. Guards: cycle, self-parent, unknown type, owner scoping.
  await expectError("cycle guard rejects descendant parent", "bad_request", () =>
    updateItem(ownerId, p.id, { parentId: c.id })
  );
  await expectError("self-parent rejected", "bad_request", () =>
    updateItem(ownerId, p.id, { parentId: p.id })
  );
  await expectError("unknown type rejected", "bad_request", () =>
    createItem(ownerId, { type: "no-such-type" })
  );
  const temp = await db
    .insert(users)
    .values({ email: "verify-items-temp@example.invalid" })
    .returning({ id: users.id });
  tempUserId = temp[0].id;
  await expectError("other owner cannot read the item", "not_found", () =>
    getItem(tempUserId!, a.id)
  );
  const tempList = await listItems(tempUserId, {});
  check("other owner sees an empty list", tempList.length === 0);

  // 9. Purge: age G past 30 days, run the job, confirm hard delete + cascade.
  await softDeleteItem(ownerId, g.id);
  await db.execute(
    sql`update items set deleted_at = now() - interval '31 days' where id = ${g.id}`
  );
  const purge = await purgeExpiredTrash();
  check("purge removes expired trash", purge.purged >= 1, JSON.stringify(purge));
  const gGone = await db.select({ id: items.id }).from(items).where(eq(items.id, g.id));
  check("purged item is hard-deleted", gGone.length === 0);
} finally {
  // Cleanup: hard-delete test items (child tables cascade) and the temp user.
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  const leftoverRevs = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(inArray(revisions.itemId, created));
  console.log(
    `cleanup: removed ${created.length} test items, ${leftoverRevs.length} stray revisions remain (expect 0)`
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
