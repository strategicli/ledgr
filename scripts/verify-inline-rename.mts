// Verification for inline label fixes (ADR-068, Feature A2): renameTypeLabel and
// renamePropertyLabel. The core invariant is that a rename moves ONLY the
// display label — the type key and the property key/role never change, so stored
// values (items.properties) and relation edges (role = key) stay intact. We prove
// the edge half for real: a typed relation edge survives a field-label rename.
// Against live Neon. Types are instance-global (no owner_id), so we track and
// delete the keys we create. Run: npx tsx scripts/verify-inline-rename.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, types, users } = await import("../src/db/schema");
const { createType, getType, renameTypeLabel, renamePropertyLabel } =
  await import("../src/lib/types");
const { ItemError } = await import("../src/lib/items");
const { createItem } = await import("../src/lib/item-mutations");
const { relateItems, outgoingRelationsByRole } = await import("../src/lib/relations");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
async function throws(name: string, fn: () => Promise<unknown> | unknown, code = "bad_request") {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    const ok = err instanceof ItemError && err.code === code;
    check(name, ok, err instanceof Error ? err.message : String(err));
  }
}

const stamp = Date.now();
const typeKey = `vir${stamp}`;
const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-inline-rename-${stamp}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;
const createdItemIds: string[] = [];

try {
  // A type with a scalar property and a typed relation field (role = its key).
  await createType({
    key: typeKey,
    label: "Book",
    icon: null,
    showInQuickCapture: true,
    capability: null,
    propertySchema: [
      { key: "subtitle", label: "Subtitle", kind: "text" },
      { key: "author", label: "Auuthor", kind: "relation", targetType: null, cardinality: "single" },
    ],
  });

  // Two items of the type, linked by the relation field's role ('author').
  const book = await createItem(ownerId, { type: typeKey, title: "A Book" });
  const writer = await createItem(ownerId, { type: typeKey, title: "Jane" });
  createdItemIds.push(book.id, writer.id);
  await relateItems(ownerId, book.id, writer.id, "author");

  const before = await outgoingRelationsByRole(ownerId, book.id, ["author"]);
  check("edge exists under role 'author' before rename", (before.get("author") ?? []).some((r) => r.id === writer.id));

  // --- renamePropertyLabel: label moves, key/edge do not ---
  const afterProp = await renamePropertyLabel(typeKey, "author", "Author");
  const authorDef = afterProp.propertySchema.find((p) => p.key === "author");
  check("property label is corrected", authorDef?.label === "Author");
  check("property key is unchanged", authorDef?.key === "author");
  check("relation targetType/cardinality preserved", authorDef?.cardinality === "single");
  const otherDef = afterProp.propertySchema.find((p) => p.key === "subtitle");
  check("sibling property untouched", otherDef?.label === "Subtitle" && otherDef?.kind === "text");

  const after = await outgoingRelationsByRole(ownerId, book.id, ["author"]);
  check("edge still under role 'author' after field rename", (after.get("author") ?? []).some((r) => r.id === writer.id));

  // --- renameTypeLabel: label moves, key does not ---
  const afterType = await renameTypeLabel(typeKey, "Volume");
  check("type label is renamed", afterType.label === "Volume");
  check("type key is unchanged", afterType.key === typeKey);
  const reread = await getType(typeKey);
  check("rename persisted", reread.label === "Volume");

  // --- validation ---
  await throws("empty label rejected", () => renameTypeLabel(typeKey, "   "));
  await throws("over-long label rejected", () => renameTypeLabel(typeKey, "x".repeat(81)));
  await throws("non-string label rejected", () => renameTypeLabel(typeKey, 5));
  await throws("rename of a missing property rejected", () => renamePropertyLabel(typeKey, "nope", "X"));
} finally {
  if (createdItemIds.length) {
    await db.delete(items).where(inArray(items.id, createdItemIds));
  }
  await db.delete(types).where(eq(types.key, typeKey));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
