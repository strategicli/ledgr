// Verifies the deterministic Discover scorer + cache (ADR-127): the signals
// surface the right candidates, the floor + exclusions keep noise out, results
// are body-free and owner-scoped, the nightly refresh populates the cache, and
// the read re-filters items linked since the last compute.
//
// Run: npx tsx scripts/verify-discover.mts
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, itemRelatedness, users } = await import("../src/db/schema");
const { ItemError, createItem, softDeleteItem } = await import("../src/lib/items");
const { relateItems } = await import("../src/lib/relations");
const { scoreRelated, suggestedRelations, readCachedRelated } = await import(
  "../src/lib/discovery/score"
);
const { refreshRelatedness } = await import("../src/lib/discovery/refresh");
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

async function note(title: string, opts: { parentId?: string; isTemplate?: boolean } = {}) {
  const row = await createItem(ownerId, {
    type: "note",
    title,
    parentId: opts.parentId,
    isTemplate: opts.isTemplate,
  });
  created.push(row.id);
  return row;
}

try {
  // --- Build a small graph that exercises each signal ---
  const parent = await note("Discover test parent container");
  const anchor = await note("Elder candidate qualifications thoughts", { parentId: parent.id });
  const sibling = await note("An unrelated sibling memo", { parentId: parent.id }); // shares parent only
  const textMatch = await note("Elder candidate evaluation form"); // shares wording
  const hub = (await createItem(ownerId, { type: "person", title: "Roger Hub Person" }));
  created.push(hub.id);
  const cocite = await note("Deacon onboarding notes"); // co-cited via the hub
  const gibberish = await note("Zxqwv plump verdigris"); // isolated → below floor
  const template = await note("Elder candidate intake template", { isTemplate: true }); // excluded
  const deleted = await note("Elder candidate retired record"); // excluded once trashed

  // anchor and cocite both point at the hub → co-citation between them.
  await relateItems(ownerId, anchor.id, hub.id);
  await relateItems(ownerId, cocite.id, hub.id);
  // trash one word-sharing candidate; it must not surface.
  await softDeleteItem(ownerId, deleted.id);

  // --- Live scoring (cache empty) ---
  const live = await scoreRelated(ownerId, anchor.id, { includeLinked: false });
  const liveIds = new Set(live.map((c) => c.id));
  const sigOf = (id: string) =>
    (live.find((c) => c.id === id)?.signals ?? []).map((s) => s.kind);

  check("text overlap surfaces a word-sharing item", liveIds.has(textMatch.id));
  check(
    "  …with a text signal",
    sigOf(textMatch.id).includes("text"),
    sigOf(textMatch.id).join(",")
  );
  check("co-citation surfaces an item sharing a neighbor", liveIds.has(cocite.id));
  check(
    "  …with a cocitation signal",
    sigOf(cocite.id).includes("cocitation"),
    sigOf(cocite.id).join(",")
  );
  check("shared parent surfaces a sibling", liveIds.has(sibling.id));
  check(
    "  …with a sharedAttr signal",
    sigOf(sibling.id).includes("sharedAttr"),
    sigOf(sibling.id).join(",")
  );
  check("floor excludes an unrelated item", !liveIds.has(gibberish.id));
  check("template prototype is excluded", !liveIds.has(template.id));
  check("soft-deleted candidate is excluded", !liveIds.has(deleted.id));
  check("anchor never suggests itself", !liveIds.has(anchor.id));
  check(
    "results are body-free",
    live.length > 0 && !("body" in live[0]) && !("bodyText" in live[0])
  );
  check(
    "every candidate clears the floor and carries signals",
    live.every((c) => c.score > 0 && c.signals.length > 0)
  );
  check("results are score-sorted desc", live.every((c, i) => i === 0 || live[i - 1].score >= c.score));

  // --- Nightly refresh populates the cache (scoped to the test anchor so it's
  // deterministic against a cold corpus) ---
  const res = await refreshRelatedness(ownerId, { ids: [anchor.id] });
  check("refresh scans the dirty anchor", res.scanned > 0, `scanned ${res.scanned}`);
  const cacheRows = await db
    .select({ candidateId: itemRelatedness.candidateId })
    .from(itemRelatedness)
    .where(eq(itemRelatedness.itemId, anchor.id));
  check("cache has rows for the anchor", cacheRows.length > 0, `${cacheRows.length} rows`);
  const cached = await readCachedRelated(ownerId, anchor.id);
  check("readCachedRelated returns the cached set", !!cached && cached.length > 0);

  // suggestedRelations reads the cache; textMatch is still unlinked → present.
  const beforeLink = await suggestedRelations(ownerId, anchor.id, { limit: 50 });
  check(
    "endpoint surfaces the candidate from cache",
    beforeLink.candidates.some((c) => c.id === textMatch.id)
  );

  // --- Read re-filters an item linked since the last compute ---
  await relateItems(ownerId, anchor.id, textMatch.id);
  const afterLink = await suggestedRelations(ownerId, anchor.id, { limit: 50 });
  check(
    "endpoint drops a now-linked candidate (read-time recheck)",
    !afterLink.candidates.some((c) => c.id === textMatch.id)
  );

  // --- Owner scoping ---
  const tmp = await db
    .insert(users)
    .values({ email: `discover-verify-${Date.now()}@example.com` })
    .returning({ id: users.id });
  tempUserId = tmp[0].id;
  let threw = false;
  try {
    await scoreRelated(tempUserId, anchor.id, {});
  } catch (err) {
    threw = err instanceof ItemError;
  }
  check("a different owner cannot score this anchor", threw);
} finally {
  if (created.length > 0) await db.delete(items).where(inArray(items.id, created));
  if (tempUserId) await db.delete(users).where(eq(users.id, tempUserId));
  console.log(`cleanup: removed ${created.length} test items`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
