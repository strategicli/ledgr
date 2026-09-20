// ADR-266 verification: the machine API tags and links on write, and takes a
// bulk import in one request.
//
// The gap this closes: POST /api/machine/items could create a note but not
// tag it. Tagging meant listing the tag type, matching titles by hand, POSTing
// the missing tags, then POSTing one edge per pair to /api/machine/relations —
// four round trips of bookkeeping per note, in a batch capped at 100. An agent
// importing a few hundred tagged notes stalled on exactly that. Now an entry
// carries `tags: ["name", …]` and `relateTo: [{ targetId, role? }]`, the tags
// are resolved or created server-side, and a batch takes 500.
//
// Runs the real route handlers against the dev DB with a real minted
// credential: no HTTP server, no mocks. DB-backed, so verify-ci.mjs classifies
// it local/manual.
//   npx tsx scripts/verify-machine-write.mts
//
// What it pins down, in order:
//  1. POST with tags creates the item, creates the missing tag items, writes
//     the `tags` edges, and says so on the row (`tags: [{ id, title, created }]`).
//  2. Matching is exact and case-blind: "Sermon Prep" / " sermon prep " reuse
//     the same tag item, no duplicates.
//  3. The edge is the app's own: role "tags", item → tag, so ?relatedTo=<tag>
//     lists the tagged items and the Tags field shows them.
//  4. PATCH is additive (existing tags stay) and works with only id + tags.
//  5. relateTo writes edges by id, as { targetId, role } or a bare uuid.
//  6. A bad tags value fails the entry up front — no item is created.
//  7. An entry with neither field gets the same row it always did (no `tags`
//     key), so existing callers' payloads are unchanged.
//  8. A 120-entry batch with shared tags lands in one request (the old cap was
//     100) and creates each tag once; 501 entries is a 400.
//  9. includeBody now returns up to 100 rows, and says when it caps.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { and, eq, inArray, isNull, sql } = await import("drizzle-orm");
const { getDb } = await import("../src/db");
const { apiCredentials, items, relations } = await import("../src/db/schema");
const { createCredential, revokeCredential } = await import("../src/lib/auth/credentials");
const { resolveMachineOwner } = await import("../src/lib/machine/owner");
const { MAX_BODY_ROWS } = await import("../src/lib/items");
const { TAG_TYPE, TAGS_ROLE } = await import("../src/lib/tags");
const listRoute = await import("../src/app/api/machine/items/route");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const ownerId = await resolveMachineOwner();
if (!ownerId) {
  console.error("No machine owner. Set DEV_USER_EMAIL in .env.local and seed the dev DB.");
  process.exit(1);
}

const made = await createCredential(ownerId, `verify-machine-write ${Date.now()}`, ["api"]);
if (!made.ok) {
  console.error(`could not mint a credential: ${made.error}`);
  process.exit(1);
}
const AUTH = `Basic ${Buffer.from(`${made.keyId}:${made.secret}`).toString("base64")}`;
const BASE = "http://localhost/api/machine/items";

// Tag names carry a run stamp so they can't collide with the owner's real tags,
// and every tag item this run creates is deleted at the end.
const STAMP = `vmw${Date.now().toString(36)}`;
const T1 = `${STAMP} Sermon Prep`;
const T2 = `${STAMP} Elders`;
const T3 = `${STAMP} Follow Up`;

// Every item id this run creates (items and tags), for cleanup.
const created = new Set<string>();
function track(rows: unknown) {
  for (const r of (rows as { id?: string; tags?: { id: string }[] }[]) ?? []) {
    if (r?.id) created.add(r.id);
    for (const t of r?.tags ?? []) created.add(t.id);
  }
}

async function post(body: unknown) {
  const res = await listRoute.POST(
    new Request(BASE, {
      method: "POST",
      headers: { authorization: AUTH, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const json = await res.json();
  track(json.created);
  return { status: res.status, json };
}
async function patch(body: unknown) {
  const res = await listRoute.PATCH(
    new Request(BASE, {
      method: "PATCH",
      headers: { authorization: AUTH, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const json = await res.json();
  track(json.updated);
  return { status: res.status, json };
}
async function list(qs: string) {
  const res = await listRoute.GET(new Request(`${BASE}${qs}`, { headers: { authorization: AUTH } }));
  return { status: res.status, json: await res.json() };
}
async function liveTagsNamed(name: string) {
  return db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId!),
        eq(items.type, TAG_TYPE),
        isNull(items.deletedAt),
        sql`lower(${items.title}) = ${name.toLowerCase()}`
      )
    );
}
async function tagEdges(itemId: string) {
  return db
    .select({ targetId: relations.targetId, role: relations.role, matchState: relations.matchState })
    .from(relations)
    .where(and(eq(relations.sourceId, itemId), eq(relations.role, TAGS_ROLE)));
}

try {
  // --- 1. POST with tags -----------------------------------------------------
  const one = await post({ type: "note", title: `${STAMP} first note`, tags: [T1, T2] });
  check("POST with tags is a 201", one.status === 201, `status ${one.status}`);
  const row1 = one.json.created?.[0];
  check("the row carries the resolved tags", Array.isArray(row1?.tags) && row1.tags.length === 2);
  check(
    "both tags were created (created: true) with their names as titles",
    row1?.tags?.every((t: { created: boolean }) => t.created === true) &&
      row1?.tags?.map((t: { title: string }) => t.title).sort().join("|") === [T1, T2].sort().join("|")
  );
  const tagRows1 = await liveTagsNamed(T1);
  check("the tag exists as a live `tag` item", tagRows1.length === 1, `${tagRows1.length} rows`);
  const edges1 = await tagEdges(row1.id);
  check(
    "two confirmed `tags` edges, item → tag",
    edges1.length === 2 && edges1.every((e) => e.matchState === "confirmed"),
    `${edges1.length} edges`
  );

  // --- 2. exact, case-blind reuse -------------------------------------------
  const two = await post({
    type: "note",
    title: `${STAMP} second note`,
    tags: [T1.toUpperCase(), `  ${T2.toLowerCase()}  `, T1],
  });
  const row2 = two.json.created?.[0];
  check(
    "a different case / padded / repeated name reuses the tag (created: false, same id)",
    row2?.tags?.length === 2 &&
      row2.tags.every((t: { created: boolean }) => t.created === false) &&
      row2.tags.some((t: { id: string }) => t.id === row1.tags[0].id) &&
      row2.tags.some((t: { id: string }) => t.id === row1.tags[1].id),
    JSON.stringify(row2?.tags)
  );
  check("no duplicate tag row was made", (await liveTagsNamed(T1)).length === 1);

  // --- 3. the edge is the app's own -----------------------------------------
  const tag1Id = row1.tags.find((t: { title: string }) => t.title === T1).id;
  const byTag = await list(`?relatedTo=${tag1Id}`);
  const idsByTag = new Set((byTag.json.items ?? []).map((r: { id: string }) => r.id));
  check(
    "?relatedTo=<tag> lists both tagged notes",
    idsByTag.has(row1.id) && idsByTag.has(row2.id),
    `${idsByTag.size} rows`
  );

  // --- 4. PATCH is additive, and tags-only works ----------------------------
  const add = await patch({ id: row1.id, title: `${STAMP} first note (renamed)`, tags: [T3] });
  check("PATCH with a field + tags is a 200", add.status === 200, `status ${add.status}`);
  const edgesAfterAdd = await tagEdges(row1.id);
  check("the new tag was added and the two existing ones stayed", edgesAfterAdd.length === 3, `${edgesAfterAdd.length} edges`);
  check("the PATCH row reports only the tags it wrote", add.json.updated?.[0]?.tags?.length === 1);

  const tagsOnly = await patch({ id: row2.id, tags: [T3] });
  check("PATCH with only id + tags is a 200 (not 'nothing to update')", tagsOnly.status === 200, JSON.stringify(tagsOnly.json.errors));
  check("…and its row is { id, tags }", tagsOnly.json.updated?.[0]?.id === row2.id && tagsOnly.json.updated?.[0]?.tags?.length === 1);
  check("…and the edge landed", (await tagEdges(row2.id)).length === 3);

  const again = await patch({ id: row2.id, tags: [T3] });
  check("re-sending the same tag is idempotent", again.status === 200 && (await tagEdges(row2.id)).length === 3);

  const nothing = await patch({ id: row2.id });
  check("PATCH with only an id is still a 400 'nothing to update'", nothing.status === 400 && nothing.json.errors?.[0]?.error === "nothing to update", JSON.stringify(nothing.json.errors));

  // --- 5. relateTo by id -----------------------------------------------------
  const project = await post({ type: "note", title: `${STAMP} a project-shaped note` });
  const projectId = project.json.created?.[0]?.id;
  const linked = await post({
    type: "task",
    title: `${STAMP} a task filed by relateTo`,
    relateTo: [{ targetId: projectId, role: "project" }, row1.id],
  });
  const linkedRow = linked.json.created?.[0];
  check("POST with relateTo is a 201 and reports the edges", linked.status === 201 && linkedRow?.relatedTo?.length === 2, JSON.stringify(linked.json.errors));
  const linkedEdges = await db
    .select({ targetId: relations.targetId, role: relations.role })
    .from(relations)
    .where(eq(relations.sourceId, linkedRow.id));
  check(
    "one 'project' edge and one default 'related' edge (bare-uuid shorthand)",
    linkedEdges.some((e) => e.targetId === projectId && e.role === "project") &&
      linkedEdges.some((e) => e.targetId === row1.id && e.role === "related"),
    JSON.stringify(linkedEdges)
  );
  const badTarget = await post({
    type: "task",
    title: `${STAMP} bad relateTo`,
    relateTo: [{ targetId: "00000000-0000-4000-8000-000000000000" }],
  });
  check(
    "relateTo to an item that doesn't exist: the item is created and the error names its id",
    badTarget.status === 201 &&
      badTarget.json.errors?.[0]?.id === badTarget.json.created?.[0]?.id &&
      /created, but/.test(badTarget.json.errors?.[0]?.error ?? ""),
    JSON.stringify(badTarget.json.errors)
  );

  // --- 6. a bad tags value fails the entry before the create ----------------
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.ownerId, ownerId));
  const bad = await post({
    items: [
      { type: "note", title: `${STAMP} bad tags`, tags: "not-an-array" },
      { type: "note", title: `${STAMP} bad tag entry`, tags: [""] },
      { type: "note", title: `${STAMP} good one`, tags: [T1] },
    ],
  });
  const after = await db.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.ownerId, ownerId));
  check("bad entries are reported by index and the good one lands", bad.status === 201 && bad.json.count === 1 && bad.json.errors?.length === 2, JSON.stringify(bad.json.errors));
  check(
    "the 400s name the field",
    bad.json.errors?.[0]?.error?.includes("tags must be an array") && bad.json.errors?.[1]?.error?.includes("tags[0]"),
    JSON.stringify(bad.json.errors)
  );
  check("no item was created for a bad entry", after[0].n - before[0].n === 1, `${after[0].n - before[0].n} new rows`);

  // --- 7. an entry without the fields is unchanged --------------------------
  const plain = await post({ type: "note", title: `${STAMP} plain` });
  const plainRow = plain.json.created?.[0] ?? {};
  check("a plain entry's row has no `tags` or `relatedTo` key", !("tags" in plainRow) && !("relatedTo" in plainRow));

  // --- 8. a real bulk batch ---------------------------------------------------
  const BULK = 120;
  const bulk = await post({
    items: Array.from({ length: BULK }, (_, i) => ({
      type: "note",
      title: `${STAMP} bulk ${i}`,
      body: { format: "markdown", text: `Note ${i}\n\nwith a body.` },
      tags: [T3, `${STAMP} bulk-only`],
    })),
  });
  check(`a ${BULK}-entry batch lands in one request (old cap was 100)`, bulk.status === 201 && bulk.json.count === BULK, `count ${bulk.json.count}, errors ${bulk.json.errors?.length}`);
  check("the shared tag was created once for the whole batch", (await liveTagsNamed(`${STAMP} bulk-only`)).length === 1);
  const over = await post({ items: Array.from({ length: 501 }, () => ({ type: "note", title: "x" })) });
  check("501 entries is a 400", over.status === 400 && /max 500/.test(over.json.error ?? ""), over.json.error);

  // --- 9. includeBody pages to 100 -------------------------------------------
  check("MAX_BODY_ROWS is 100", MAX_BODY_ROWS === 100, String(MAX_BODY_ROWS));
  const bulkIds = bulk.json.created.map((r: { id: string }) => r.id);
  const bodies = await list(`?id=${bulkIds.join(",")}&includeBody=true&limit=150`);
  check(
    `includeBody returns ${MAX_BODY_ROWS} of ${BULK} and says it capped`,
    bodies.status === 200 && bodies.json.items?.length === MAX_BODY_ROWS && typeof bodies.json.note === "string",
    `${bodies.json.items?.length} rows, note: ${bodies.json.note}`
  );
  check("each row carries its { format, text } body", bodies.json.items.every((r: { body?: { text?: string } }) => typeof r.body?.text === "string"));
  const page2 = await list(`?id=${bulkIds.join(",")}&includeBody=true&limit=150&offset=${MAX_BODY_ROWS}`);
  check("offset pages past the cap to the rest", page2.json.items?.length === BULK - MAX_BODY_ROWS, `${page2.json.items?.length} rows`);
} finally {
  const ids = [...created];
  if (ids.length > 0) await db.delete(items).where(inArray(items.id, ids));
  await revokeCredential(ownerId, made.credential.id);
  await db.delete(apiCredentials).where(eq(apiCredentials.id, made.credential.id));
  console.log(`cleanup: removed ${ids.length} test items (incl. tags) and the test credential`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
