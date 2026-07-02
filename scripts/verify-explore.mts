// Verifies the Related Explorer's data merge (ADR-127 Phase 2): the
// neighborhood unifies existing links AND discovered candidates, flags linked
// rows, surfaces a plain manual link the signals never gathered, sorts by
// score, and stays owner-scoped.
//
// Run: npx tsx scripts/verify-explore.mts
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/item-mutations");
const { relateItems } = await import("../src/lib/relations");
const { exploreNeighborhood } = await import("../src/lib/discovery/explore");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const owners = await db.select({ id: users.id }).from(users);
if (owners.length === 0) {
  console.error("no users in DB; cannot run");
  process.exit(1);
}
const ownerId = owners[0].id;

const created: string[] = [];
let tempUserId: string | null = null;

async function note(title: string) {
  const row = await createItem(ownerId, { type: "note", title });
  created.push(row.id);
  return row;
}

try {
  const anchor = await note("Strategic planning offsite agenda");
  const linkedWord = await note("Strategic planning notes"); // shares words + linked
  const candWord = await note("Strategic planning followups"); // shares words, not linked
  const plainLink = await note("Zzqq unrelated wording entirely"); // linked, no signal

  await relateItems(ownerId, anchor.id, linkedWord.id);
  await relateItems(ownerId, anchor.id, plainLink.id);

  const rows = await exploreNeighborhood(ownerId, anchor.id);
  const byId = new Map(rows.map((r) => [r.id, r]));

  check("explorer includes a linked, word-sharing neighbor", byId.has(linkedWord.id));
  check("  …flagged linked", byId.get(linkedWord.id)?.linked === true);
  check(
    "  …with a computed score",
    (byId.get(linkedWord.id)?.score ?? 0) > 0,
    String(byId.get(linkedWord.id)?.score)
  );
  check("explorer includes an unlinked candidate", byId.has(candWord.id));
  check("  …flagged not linked", byId.get(candWord.id)?.linked === false);
  check(
    "plain manual link is unioned in (no signal)",
    byId.has(plainLink.id) && byId.get(plainLink.id)?.linked === true,
    `score ${byId.get(plainLink.id)?.score}`
  );
  check("anchor never appears in its own map", !byId.has(anchor.id));
  check(
    "rows are score-sorted desc",
    rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score)
  );

  // Owner scoping: a different owner can't read this anchor's neighborhood.
  const tmp = await db
    .insert(users)
    .values({ email: `explore-verify-${Date.now()}@example.com` })
    .returning({ id: users.id });
  tempUserId = tmp[0].id;
  let threw = false;
  try {
    await exploreNeighborhood(tempUserId, anchor.id);
  } catch {
    threw = true;
  }
  check("a different owner cannot explore this anchor", threw);
} finally {
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  console.log(`cleanup: removed ${created.length} test items`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
