// passage_refs body-sync + read-query verification (ADR-143, slice 2) against
// live Neon under throwaway owners. Covers: syncPassageRefs on create/update
// (add/remove/dedup diffing), resolvePassageRefs, the itemsTouchingPassage
// overlap query, owner-scoping, soft-delete exclusion, and role coexistence (a
// non-'passage' edge survives the body sync — the auto-tagger guarantee).
// Run: npx tsx scripts/verify-passage-refs.mts
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

const { getDb } = await import("../src/db");
const { items, users, passageRefs } = await import("../src/db/schema");
const { createItem, updateItem } = await import("../src/lib/item-mutations");
const { makeMarkdownBody } = await import("../src/lib/body");
const { parsePassageRef, passageToMarkdown } = await import("../src/lib/passages/ref");
const { resolvePassageRefs, itemsTouchingPassage, PASSAGE_ROLE } = await import("../src/lib/passages/refs");
const { eq: dEq, inArray } = await import("drizzle-orm");

const keyset = (arr: { startRef: number; endRef: number }[]) =>
  new Set(arr.map((r) => `${r.startRef}-${r.endRef}`));

const rom8 = parsePassageRef("Rom 8:5-9")!; // 45008005-45008009
const john316 = parsePassageRef("John 3:16")!; // 43003016
const rom12 = parsePassageRef("Rom 12:2")!; // 45012002
const link = (r: { startRef: number; endRef: number }) => passageToMarkdown(r.startRef, r.endRef);

const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-pr-${stamp}@example.invalid` }).returning({ id: users.id });
const [other] = await db.insert(users).values({ email: `verify-pr-other-${stamp}@example.invalid` }).returning({ id: users.id });

try {
  console.log("\n# Create: body passage links become edges (dedup)");
  const body0 = [link(rom8), "some prose about grace", link(john316), link(rom8)].join("\n\n");
  const item = await createItem(owner.id, { type: "note", title: "passage test", body: makeMarkdownBody(body0) });
  let refs = await resolvePassageRefs(owner.id, item.id);
  check("two distinct edges created (duplicate collapsed)", refs.length === 2, `${refs.length}`);
  check("edges match the body's refs", keyset(refs).has("45008005-45008009") && keyset(refs).has("43003016-43003016"));
  check("all edges carry the 'passage' role", refs.every((r) => r.role === PASSAGE_ROLE));

  console.log("\n# Overlap query (the passage page / backlinks)");
  const touch7 = await itemsTouchingPassage(owner.id, parsePassageRef("Rom 8:7")!);
  check("Rom 8:7 (inside 8:5-9) finds the item", touch7.some((b) => b.itemId === item.id));
  const touch12 = await itemsTouchingPassage(owner.id, parsePassageRef("Rom 8:12")!);
  check("Rom 8:12 (outside 8:5-9) does not", !touch12.some((b) => b.itemId === item.id));
  const touchJohn = await itemsTouchingPassage(owner.id, parsePassageRef("John 3")!);
  check("John 3 (whole chapter) overlaps John 3:16", touchJohn.some((b) => b.itemId === item.id));

  console.log("\n# Update: diff add + remove");
  const body1 = [link(rom8), link(rom12)].join("\n\n"); // drop John, add Rom 12:2
  await updateItem(owner.id, item.id, { body: makeMarkdownBody(body1) });
  refs = await resolvePassageRefs(owner.id, item.id);
  check("removed link's edge is gone (John 3:16)", !keyset(refs).has("43003016-43003016"));
  check("added link's edge exists (Rom 12:2)", keyset(refs).has("45012002-45012002"));
  check("kept link's edge remains (Rom 8:5-9)", keyset(refs).has("45008005-45008009"));
  check("count is now 2", refs.length === 2, `${refs.length}`);

  console.log("\n# Role coexistence: a non-'passage' edge survives the body sync");
  await db.insert(passageRefs).values({ sourceItemId: item.id, startRef: rom8.startRef, endRef: rom8.endRef, role: "suggested" });
  await updateItem(owner.id, item.id, { body: makeMarkdownBody("no passage links at all now") });
  refs = await resolvePassageRefs(owner.id, item.id);
  check("all 'passage' edges cleared by the empty body", refs.filter((r) => r.role === PASSAGE_ROLE).length === 0);
  check("the 'suggested' edge was NOT deleted", refs.some((r) => r.role === "suggested"), `${refs.length} total`);

  console.log("\n# Owner-scoping + soft-delete exclusion");
  const otherItem = await createItem(other.id, { type: "note", title: "other owner", body: makeMarkdownBody(link(rom8)) });
  const scoped = await itemsTouchingPassage(owner.id, parsePassageRef("Rom 8:7")!);
  check("other owner's item is not in owner's overlap results", !scoped.some((b) => b.itemId === otherItem.id));
  check("resolvePassageRefs is owner-scoped (other owner sees nothing on our item)", (await resolvePassageRefs(other.id, item.id)).length === 0);
  // Give owner an item that touches Rom 8, then soft-delete it.
  const toDelete = await createItem(owner.id, { type: "note", title: "will delete", body: makeMarkdownBody(link(rom8)) });
  check("pre-delete: the item shows in overlap", (await itemsTouchingPassage(owner.id, parsePassageRef("Rom 8:7")!)).some((b) => b.itemId === toDelete.id));
  await db.update(items).set({ deletedAt: new Date() }).where(dEq(items.id, toDelete.id));
  check("post-soft-delete: the item is excluded from overlap", !(await itemsTouchingPassage(owner.id, parsePassageRef("Rom 8:7")!)).some((b) => b.itemId === toDelete.id));
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o)); // passage_refs + revisions cascade
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
