// Verifies the Loose Ends engine (ADR-127 Phase 3): under-connected items with
// a real suggestion surface (with that suggestion + degree), well-connected
// items are excluded, an orphan with no candidate is skipped (not shown empty),
// and it's owner-scoped.
//
// Run: npx tsx scripts/verify-loose-ends.mts
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
const { findLooseEnds } = await import("../src/lib/discovery/loose-ends");
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
  // A loose pair that shares wording → each is the other's suggestion. Freshly
  // created, so they sort to the front of the degree-0 scan.
  const loose = await note("Quarterly budget planning loose thread");
  const mate = await note("Quarterly budget planning committee");
  // An orphan with no possible candidate → must be skipped, not shown empty.
  const orphan = await note("Zxqwv lonely gibberish token");
  // A well-connected item (degree 4 > DEGREE_MAX) → must be excluded.
  const hub = await note("Well connected hub note");
  for (let i = 0; i < 4; i++) {
    const spoke = await note(`Connector spoke ${i} qpzm`);
    await relateItems(ownerId, hub.id, spoke.id);
  }

  const ends = await findLooseEnds(ownerId, { limit: 20 });
  const byId = new Map(ends.map((e) => [e.id, e]));

  check("a loose item with a candidate is surfaced", byId.has(loose.id));
  check(
    "  …with its word-sharing suggestion inline",
    (byId.get(loose.id)?.suggestions ?? []).some((s) => s.id === mate.id)
  );
  check("  …reporting degree 0", byId.get(loose.id)?.degree === 0);
  check("the orphan with no candidate is skipped", !byId.has(orphan.id));
  check("the well-connected hub (degree 4) is excluded", !byId.has(hub.id));
  check(
    "every returned loose end has at least one suggestion",
    ends.every((e) => e.suggestions.length > 0)
  );

  // Owner scoping: a fresh owner with no items has no loose ends.
  const tmp = await db
    .insert(users)
    .values({ email: `loose-verify-${Date.now()}@example.com` })
    .returning({ id: users.id });
  tempUserId = tmp[0].id;
  const otherEnds = await findLooseEnds(tempUserId);
  check("a different owner sees none of these items", otherEnds.length === 0);
} finally {
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  console.log(`cleanup: removed ${created.length} test items`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
