// Cross-device edit guard verification (ADR-134): the bodyDigest helper (pure)
// and updateItem's optimistic body-conflict check against live Neon. The guard's
// core invariant: a body write that carries an expectedBodyDigest matching the
// stored body writes; one whose digest is stale (another "device" wrote since)
// is refused with an ItemError code "conflict", instead of silently clobbering.
// Also: omitting the digest keeps last-write-wins; a no-op body never conflicts;
// getItemVersion returns updated_at and is owner-scoped.
// Run: npx tsx scripts/verify-concurrent-edit.mts
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { bodyDigest, makeMarkdownBody, bodyMarkdown } = await import("../src/lib/body");

console.log("\n# Pure: bodyDigest");
{
  const a = makeMarkdownBody("the quick brown fox");
  check("deterministic: same input, same digest", bodyDigest(a) === bodyDigest(makeMarkdownBody("the quick brown fox")));
  check("sensitive: one-char change differs", bodyDigest(a) !== bodyDigest(makeMarkdownBody("the quick brown fix")));
  check("empty/null/absent all agree", bodyDigest(makeMarkdownBody("")) === bodyDigest(null) && bodyDigest(null) === bodyDigest(undefined));
  check("format-agnostic: digests the text only", bodyDigest({ format: "chordpro", text: "x" }) === bodyDigest({ format: "markdown", text: "x" }));
  check("length-tagged: differing lengths differ", bodyDigest(makeMarkdownBody("aa")) !== bodyDigest(makeMarkdownBody("aaa")));
}

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const {
  getItem,
  getItemVersion,
  ItemError,
} = await import("../src/lib/items");
const {
  createItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { eq: dEq, inArray } = await import("drizzle-orm");

async function throwsConflict(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    check(name, err instanceof ItemError && err.code === "conflict", err instanceof Error ? err.message : "non-error");
  }
}
async function throwsNotFound(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    check(name, err instanceof ItemError && err.code === "not_found", err instanceof Error ? err.message : "non-error");
  }
}

const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-cc-${stamp}@example.invalid` }).returning({ id: users.id });
const [other] = await db.insert(users).values({ email: `verify-cc-other-${stamp}@example.invalid` }).returning({ id: users.id });

try {
  console.log("\n# Service: the guard accepts a matching digest, refuses a stale one");
  const V0 = "shared opening\noriginal body";
  const item = await createItem(owner.id, { type: "note", title: "cc test", body: makeMarkdownBody(V0) });
  const digestV0 = bodyDigest(makeMarkdownBody(V0));

  // Device 1 loaded V0; its first guarded edit (digest matches stored) writes.
  const V1 = "shared opening\nedited on device 1";
  const afterV1 = await updateItem(owner.id, item.id, { body: makeMarkdownBody(V1), expectedBodyDigest: digestV0 });
  check("matching digest writes", bodyMarkdown(afterV1.body) === V1);

  // A second device "loaded V0" too; it now tries to write with the V0 digest,
  // but the stored body is V1 → conflict, V1 preserved.
  const V2 = "shared opening\nedited on device 2";
  await throwsConflict("stale digest is refused (409 conflict)", () =>
    updateItem(owner.id, item.id, { body: makeMarkdownBody(V2), expectedBodyDigest: digestV0 })
  );
  check("the refused write left the stored body untouched", bodyMarkdown((await getItem(owner.id, item.id)).body) === V1);

  console.log("\n# Service: a resynced device writes; omitting the token = last-write-wins");
  // Device 2 reloads (now sees V1), edits with the V1 digest → writes.
  const afterV2 = await updateItem(owner.id, item.id, { body: makeMarkdownBody(V2), expectedBodyDigest: bodyDigest(makeMarkdownBody(V1)) });
  check("resynced digest writes", bodyMarkdown(afterV2.body) === V2);

  // "Keep mine" / MCP / batch: no token → overwrite regardless of staleness.
  const V3 = "forced overwrite";
  const afterV3 = await updateItem(owner.id, item.id, { body: makeMarkdownBody(V3) });
  check("no token overwrites (last-write-wins preserved)", bodyMarkdown(afterV3.body) === V3);

  console.log("\n# Service: a no-op body never conflicts even with a stale token");
  // Re-PATCHing the identical body is the editor's on-open phantom save: writeBody
  // is false, so the guard is never reached and a stale token can't trip it.
  const afterNoop = await updateItem(owner.id, item.id, { body: makeMarkdownBody(V3), expectedBodyDigest: "deliberately.stale" });
  check("identical-body PATCH with a stale token is a safe no-op", bodyMarkdown(afterNoop.body) === V3);

  console.log("\n# Service: getItemVersion");
  const ver = await getItemVersion(owner.id, item.id);
  check("getItemVersion returns updated_at as a Date", ver.updatedAt instanceof Date);
  check("getItemVersion matches the item's updatedAt", ver.updatedAt.getTime() === (await getItem(owner.id, item.id)).updatedAt.getTime());
  await throwsNotFound("getItemVersion rejects another owner's item", () => getItemVersion(other.id, item.id));
  await throwsNotFound("getItemVersion rejects an unknown id", () => getItemVersion(owner.id, randomUUID()));
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o)); // revisions cascade
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
