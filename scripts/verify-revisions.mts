// Track changes verification: the word-level diff engine (src/lib/diff.ts, pure)
// + the revision read/restore service against live Neon (getRevision, the
// create snapshot, restore-to-an-older-version, owner-scoping).
//
// The diff's core correctness invariant: dropping the `add` segments must
// reconstruct the OLD text exactly, and dropping the `del` segments must
// reconstruct the NEW text exactly. We assert that across many shapes, plus
// prefix/suffix-trim and the large-input coarse fallback.
// Run: npx tsx scripts/verify-revisions.mts
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { tokenizeWords, diffWords, diffStats } = await import("../src/lib/diff");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
async function throwsNotFound(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    check(name, err instanceof Error && /not found/i.test(err.message), err instanceof Error ? err.message : "non-error");
  }
}

// The diff invariant: filter(!add)->a, filter(!del)->b.
function reconstructs(a: string, b: string): boolean {
  const segs = diffWords(a, b);
  const aBack = segs.filter((s) => s.op !== "add").map((s) => s.text).join("");
  const bBack = segs.filter((s) => s.op !== "del").map((s) => s.text).join("");
  return aBack === a && bBack === b;
}

console.log("\n# Pure: tokenizer");
{
  const samples = ["", "one", "one two", "  leading\n\nblank ", "a\nb\nc", "punct, and. more!", "tabs\tand   spaces"];
  for (const s of samples) {
    check(`tokenize reproduces ${JSON.stringify(s)}`, tokenizeWords(s).join("") === s);
  }
}

console.log("\n# Pure: diff reconstruction invariant");
{
  const pairs: [string, string][] = [
    ["", ""],
    ["", "brand new content"],
    ["everything removed", ""],
    ["the quick brown fox", "the quick brown fox"], // no change
    ["the quick brown fox", "the quick red fox"], // one word swap
    ["the quick brown fox", "the very quick brown fox jumps"], // insert mid + append
    ["alpha beta gamma delta", "gamma delta epsilon zeta"], // suffix kept, prefix gone
    ["keep this start middle keep this end", "keep this start CHANGED keep this end"], // prefix+suffix trim
    ["line one\nline two\nline three", "line one\nline two changed\nline three\nline four"], // multiline
    ["a a a b c", "a b c a a"], // reorder / repeats (LCS stress)
    ["## Heading\n\nSome **bold** text.", "## Heading\n\nSome *italic* text and more."], // markdown
  ];
  for (const [a, b] of pairs) {
    check(`reconstructs ${JSON.stringify(a).slice(0, 24)} → ${JSON.stringify(b).slice(0, 24)}`, reconstructs(a, b));
  }
}

console.log("\n# Pure: diff segment shapes + stats");
{
  check("identical → single eq segment", JSON.stringify(diffWords("same text", "same text")) === JSON.stringify([{ op: "eq", text: "same text" }]));
  check("empty→empty → []", diffWords("", "").length === 0);
  const insert = diffWords("hello world", "hello brave new world");
  check("pure insert has add, no del", insert.some((s) => s.op === "add") && !insert.some((s) => s.op === "del"));
  const remove = diffWords("hello brave new world", "hello world");
  check("pure delete has del, no add", remove.some((s) => s.op === "del") && !remove.some((s) => s.op === "add"));
  const swap = diffWords("the quick brown fox", "the quick red fox");
  const st = diffStats(swap);
  check("stats count changed words (+1 −1)", st.added === 1 && st.removed === 1, `+${st.added} −${st.removed}`);
  check("whitespace-only change counts no words", (() => { const s = diffStats(diffWords("a b", "a  b")); return s.added === 0 && s.removed === 0; })());
}

console.log("\n# Pure: large-input coarse fallback");
{
  // Two big, fully-different middles (no common prefix/suffix) blow past the
  // LCS cell cap → coarse del-all + add-all, still reconstructing both.
  const a = Array.from({ length: 2000 }, (_, i) => `a${i}`).join(" ");
  const b = Array.from({ length: 2000 }, (_, i) => `b${i}`).join(" ");
  const t0 = Date.now();
  const ok = reconstructs(a, b);
  check("huge fully-different diff reconstructs", ok);
  check("huge diff returns fast (coarse path)", Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, revisions, users } = await import("../src/db/schema");
const {
  getItem,
  getRevision,
  listRevisions,
} = await import("../src/lib/items");
const {
  createItem,
  restoreRevision,
} = await import("../src/lib/item-mutations");
const { makeMarkdownBody, bodyMarkdown } = await import("../src/lib/body");
const { eq: dEq, inArray } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-rev-${stamp}@example.invalid` }).returning({ id: users.id });
const [other] = await db.insert(users).values({ email: `verify-rev-other-${stamp}@example.invalid` }).returning({ id: users.id });

try {
  console.log("\n# Service: create snapshot + getRevision");
  const V1 = "V1 current\nshared middle\ntail";
  const item = await createItem(owner.id, { type: "note", title: "history test", body: makeMarkdownBody(V1) });
  let revs = await listRevisions(owner.id, item.id);
  check("createItem with a body writes one revision", revs.length === 1, `count=${revs.length}`);
  const createdRev = revs[0];
  const got = await getRevision(owner.id, item.id, createdRev.id);
  check("getRevision returns the snapshot text", got.text === V1);
  check("getRevision carries id + createdAt", got.id === createdRev.id && got.createdAt instanceof Date);

  console.log("\n# Service: restore to an older, different version");
  // Inject an older snapshot with distinct content (bypasses the 5-min debounce
  // that would otherwise skip a same-minute second snapshot).
  const V0 = "V0 original\nshared middle\ntail";
  const [oldRev] = await db
    .insert(revisions)
    .values({ itemId: item.id, body: makeMarkdownBody(V0), createdAt: new Date(stamp - 10 * 60 * 1000) })
    .returning({ id: revisions.id });
  revs = await listRevisions(owner.id, item.id);
  check("list now has 2, newest first", revs.length === 2 && revs[0].id === createdRev.id && revs[1].id === oldRev.id);

  // The diff a user would see restoring V0 (V0 → current V1): both lines change,
  // the shared middle + tail stay.
  const diff = diffWords(V0, V1);
  check("V0→V1 diff keeps the shared middle", diff.some((s) => s.op === "eq" && s.text.includes("shared middle")));
  check("V0→V1 diff reconstructs both", reconstructs(V0, V1));

  const restored = await restoreRevision(owner.id, item.id, oldRev.id);
  check("restore sets the body to the older version", bodyMarkdown(restored.body) === V0);
  check("getItem confirms the restored body", bodyMarkdown((await getItem(owner.id, item.id)).body) === V0);
  revs = await listRevisions(owner.id, item.id);
  check("restore force-snapshots the pre-restore body (now 3)", revs.length === 3, `count=${revs.length}`);
  check("the new snapshot is the pre-restore current (V1)", (await getRevision(owner.id, item.id, revs[0].id)).text === V1);

  console.log("\n# Service: guards + owner-scoping");
  await throwsNotFound("getRevision rejects an unknown revision id", () => getRevision(owner.id, item.id, randomUUID()));
  await throwsNotFound("getRevision rejects another owner's item", () => getRevision(other.id, item.id, oldRev.id));
  await throwsNotFound("listRevisions rejects another owner's item", () => listRevisions(other.id, item.id));
  await throwsNotFound("restoreRevision rejects another owner's item", () => restoreRevision(other.id, item.id, oldRev.id));
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o)); // revisions cascade
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
