// Slice 7 verification (next_steps.md): exercises the subtree/ancestor read
// path (src/lib/subtasks.ts) against the live Neon DB, then cleans up.
// Run with: npx tsx scripts/verify-subtasks.mts
// Safe to delete once slice 7 is closed (like verify-relations.mts).
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
const { items, users } = await import("../src/db/schema");
const { ItemError } = await import("../src/lib/items");
const {
  createItem,
  softDeleteItem,
  restoreItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { listSubtree, listAncestors } = await import("../src/lib/subtasks");
const { eq, inArray, sql } = await import("drizzle-orm");

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
  // 1. Fixture: project-shaped tree.
  //    P (task) -> C1 (task) -> GC (task)
  //             -> C2 (task, done)
  //             -> N  (note)
  const P = await createItem(ownerId, { type: "task", title: "Verify Parent" });
  const C1 = await createItem(ownerId, { type: "task", title: "Child 1", parentId: P.id });
  const C2 = await createItem(ownerId, { type: "task", title: "Child 2", parentId: P.id });
  const N = await createItem(ownerId, { type: "note", title: "Child Note", parentId: P.id });
  const GC = await createItem(ownerId, { type: "task", title: "Grandchild", parentId: C1.id });
  created.push(P.id, C1.id, C2.id, N.id, GC.id);
  await updateItem(ownerId, C2.id, { status: "done" });

  // 2. Tree shape, order, nesting, body exclusion.
  const tree = await listSubtree(ownerId, P.id);
  check(
    "direct children in creation order",
    tree.children.map((c) => c.id).join(",") === [C1.id, C2.id, N.id].join(","),
    tree.children.map((c) => c.title).join(",")
  );
  const c1 = tree.children.find((c) => c.id === C1.id)!;
  check("grandchild nests under its parent", c1.children.length === 1 && c1.children[0].id === GC.id);
  check("subtree rows carry no body", tree.children.every((c) => !("body" in c) && !("bodyText" in c)));

  // 3. Rollups: direct task children only; null when there are none.
  check("root rollup counts task children (1/2 done)", tree.progress?.done === 1 && tree.progress?.total === 2, JSON.stringify(tree.progress));
  check("note child lists but stays out of the rollup", tree.children.some((c) => c.id === N.id) && tree.progress?.total === 2);
  check("nested parent has its own rollup (0/1)", c1.progress?.done === 0 && c1.progress?.total === 1, JSON.stringify(c1.progress));
  const c2 = tree.children.find((c) => c.id === C2.id)!;
  check("leaf task has no rollup", c2.progress === null);

  await updateItem(ownerId, GC.id, { status: "done" });
  const afterDone = await listSubtree(ownerId, P.id);
  check(
    "rollup follows a status change (1/1 on C1)",
    afterDone.children.find((c) => c.id === C1.id)!.progress?.done === 1
  );

  // 4. Trash: a soft-deleted branch (C1 + GC via cascade) drops out and the
  // rollup recomputes; restore brings the branch back.
  await softDeleteItem(ownerId, C1.id);
  const afterTrash = await listSubtree(ownerId, P.id);
  check("trashed branch drops out", !afterTrash.children.some((c) => c.id === C1.id) && afterTrash.children.length === 2);
  check("rollup recomputes without the branch (1/1)", afterTrash.progress?.done === 1 && afterTrash.progress?.total === 1, JSON.stringify(afterTrash.progress));
  await restoreItem(ownerId, C1.id);
  const afterRestore = await listSubtree(ownerId, P.id);
  check(
    "restored branch returns with its child",
    afterRestore.children.some((c) => c.id === C1.id) &&
      afterRestore.children.find((c) => c.id === C1.id)!.children.length === 1
  );

  // 5. Ancestors: root-first chain, empty at the root, body-free.
  const crumbs = await listAncestors(ownerId, GC.id);
  check("ancestor chain is root-first", crumbs.map((a) => a.id).join(",") === [P.id, C1.id].join(","), crumbs.map((a) => a.title).join(" / "));
  check("root item has no ancestors", (await listAncestors(ownerId, P.id)).length === 0);
  check("ancestor rows carry no body", crumbs.every((a) => !("body" in a)));

  // 6. Owner scoping: a foreign child planted under P (raw insert; the API
  // guard would reject it) never lists, and the other owner can't read the
  // tree at all.
  const temp = await db
    .insert(users)
    .values({ email: "verify-subtasks-temp@example.invalid" })
    .returning({ id: users.id });
  tempUserId = temp[0].id;
  const foreign = await db
    .insert(items)
    .values({ ownerId: tempUserId, type: "task", title: "Foreign child", parentId: P.id })
    .returning({ id: items.id });
  created.push(foreign[0].id);
  const scoped = await listSubtree(ownerId, P.id);
  check("cross-owner child is excluded", !scoped.children.some((c) => c.id === foreign[0].id));
  await expectError("other owner cannot read the subtree", "not_found", () =>
    listSubtree(tempUserId!, P.id)
  );
  check(
    "cross-owner ancestor truncates the chain",
    (await listAncestors(tempUserId, foreign[0].id)).length === 0
  );
  await expectError("unknown root 404s", "not_found", () =>
    listSubtree(ownerId, "00000000-0000-0000-0000-000000000000")
  );

  // 7. Cycle safety. The write guard refuses a descendant parent; and if a
  // cycle exists anyway (corruption), both reads still terminate.
  await expectError("write guard refuses a descendant parent", "bad_request", () =>
    updateItem(ownerId, P.id, { parentId: GC.id })
  );
  await db.execute(sql`update items set parent_id = ${GC.id} where id = ${P.id}`);
  const cyclic = await listSubtree(ownerId, P.id);
  check(
    "subtree read terminates on a corrupted cycle, root never lists as its own child",
    cyclic.children.length === 3 && !JSON.stringify(cyclic).includes(`"id":"${P.id}"`)
  );
  const cyclicCrumbs = await listAncestors(ownerId, GC.id);
  check("ancestor read terminates on a corrupted cycle", cyclicCrumbs.length <= 3, cyclicCrumbs.map((a) => a.title).join(" / "));
  await db.execute(sql`update items set parent_id = null where id = ${P.id}`);
} finally {
  // Cleanup: hard-delete test items (one statement, so the self-FK between
  // them is checked after all are gone) and the temp user.
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  console.log(`cleanup: removed ${created.length} test items`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
