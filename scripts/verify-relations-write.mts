// Slice 15 verification (next_steps.md): exercises the relations write path
// (relate / un-relate / confirm in src/lib/relations.ts) against the live
// Neon DB, then cleans up. Run with: npx tsx scripts/verify-relations-write.mts
// Safe to delete once slice 15 is closed (like verify-relations.mts).
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
const { ItemError } = await import("../src/lib/items");
const {
  createItem,
  softDeleteItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { confirmRelations, listRelatedItems, relateItems, unrelateItems } =
  await import("../src/lib/relations");
const { makeMarkdownBody } = await import("../src/lib/body");
const { mentionToMarkdown } = await import("../src/lib/editor/mention-markdown");
const { and, eq, inArray, or } = await import("drizzle-orm");

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

async function edgesBetween(a: string, b: string) {
  return db
    .select({
      sourceId: relations.sourceId,
      targetId: relations.targetId,
      role: relations.role,
      matchState: relations.matchState,
    })
    .from(relations)
    .where(
      or(
        and(eq(relations.sourceId, a), eq(relations.targetId, b)),
        and(eq(relations.sourceId, b), eq(relations.targetId, a))
      )
    );
}

try {
  const E = await createItem(ownerId, { type: "person", title: "WriteVerify Person" });
  const T = await createItem(ownerId, { type: "task", title: "WriteVerify Task" });
  const N = await createItem(ownerId, { type: "note", title: "WriteVerify Note" });
  created.push(E.id, T.id, N.id);

  // 1. relate: creates a confirmed edge, source -> target, default role.
  const edge = await relateItems(ownerId, T.id, E.id);
  check("relate creates the edge", edge.sourceId === T.id && edge.targetId === E.id);
  check("relate defaults to role 'related'", edge.role === "related");
  check("relate defaults to confirmed", edge.matchState === "confirmed");
  const listed = await listRelatedItems(ownerId, E.id);
  check("related item lists on the person", listed.some((r) => r.id === T.id));

  // 2. Idempotent: relating again leaves exactly one row.
  await relateItems(ownerId, T.id, E.id);
  check("re-relate is idempotent", (await edgesBetween(T.id, E.id)).length === 1);

  // 3. Relating over a suggested edge confirms it (the upsert).
  await db.insert(relations).values({ sourceId: N.id, targetId: E.id, role: "related", matchState: "suggested" as const });
  const upserted = await relateItems(ownerId, N.id, E.id);
  check("relate over a suggested edge confirms it", upserted.matchState === "confirmed");
  check("...still one row", (await edgesBetween(N.id, E.id)).length === 1);

  // 4. Validation: self, mention role, unknown target, trashed target.
  await expectError("self-relate is refused", "bad_request", () => relateItems(ownerId, T.id, T.id));
  await expectError("role 'mention' is refused", "bad_request", () => relateItems(ownerId, T.id, E.id, "mention"));
  await expectError("unknown target 404s", "not_found", () =>
    relateItems(ownerId, T.id, "00000000-0000-0000-0000-000000000000")
  );
  await softDeleteItem(ownerId, N.id);
  await expectError("trashed target is refused", "bad_request", () => relateItems(ownerId, T.id, N.id));
  await db.update(items).set({ deletedAt: null }).where(eq(items.id, N.id)); // restore for later checks

  // 5. confirm: flips suggested edges between the pair, both directions.
  await db.insert(relations).values([
    { sourceId: T.id, targetId: N.id, role: "tag", matchState: "suggested" as const },
    { sourceId: N.id, targetId: T.id, role: "extracted", matchState: "suggested" as const },
  ]);
  const confirmed = await confirmRelations(ownerId, T.id, N.id);
  check("confirm flips both directions", confirmed.confirmed === 2, String(confirmed.confirmed));
  check("no suggested edges remain on the pair",
    (await edgesBetween(T.id, N.id)).every((e) => e.matchState === "confirmed"));

  // 6. un-relate with suggestedOnly (reject): leaves confirmed edges alone.
  await db.insert(relations).values({ sourceId: T.id, targetId: N.id, role: "suggested-only", matchState: "suggested" as const });
  const rejected = await unrelateItems(ownerId, T.id, N.id, { suggestedOnly: true });
  check("reject removes only the suggested edge", rejected.removed === 1, String(rejected.removed));
  check("confirmed edges survive a reject", (await edgesBetween(T.id, N.id)).length === 2);

  // 7. un-relate removes every non-mention edge, both directions; a mention
  // edge survives because the body owns it.
  await updateItem(ownerId, T.id, {
    body: makeMarkdownBody(`see ${mentionToMarkdown(N.id, N.title)}`),
  });
  check("mention sync created its edge", (await edgesBetween(T.id, N.id)).length === 3);
  const removed = await unrelateItems(ownerId, T.id, N.id);
  check("un-relate removes both manual edges", removed.removed === 2, String(removed.removed));
  const remaining = await edgesBetween(T.id, N.id);
  check("the mention edge survives un-relate", remaining.length === 1 && remaining[0].role === "mention");
  check("both items still exist (un-relate, never delete)",
    (await db.select({ id: items.id }).from(items).where(inArray(items.id, [T.id, N.id]))).length === 2);

  // 8. Owner scoping: a different owner can do nothing to these items.
  const temp = await db
    .insert(users)
    .values({ email: "verify-relations-write-temp@example.invalid" })
    .returning({ id: users.id });
  tempUserId = temp[0].id;
  await expectError("other owner cannot relate my items", "not_found", () =>
    relateItems(tempUserId!, T.id, E.id)
  );
  await expectError("other owner cannot un-relate my items", "not_found", () =>
    unrelateItems(tempUserId!, T.id, E.id)
  );
  await expectError("other owner cannot confirm my edges", "not_found", () =>
    confirmRelations(tempUserId!, T.id, E.id)
  );
  const X = await db
    .insert(items)
    .values({ ownerId: tempUserId, type: "task", title: "Other Owner Task" })
    .returning({ id: items.id });
  created.push(X[0].id);
  await expectError("cannot relate to another owner's item", "not_found", () =>
    relateItems(ownerId, T.id, X[0].id)
  );
} finally {
  // Cleanup: hard-delete test items (relations cascade) and the temp user.
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  console.log(`cleanup: removed ${created.length} test items`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
