// Meeting recording v1a verification (ADR-087): the transcript data layer
// against live Neon under a throwaway owner. Covers createTranscript (the child
// + the confirmed meeting→transcript edge + minutes=none), the MCP-discovery
// path (a meeting's related list AND a relatedTo list query surface the
// transcript — the "pull a meeting's transcripts" hop), listMeetingTranscripts
// word counts, the awaiting-minutes view filter (none in, draft/done out), and
// the guards (parent must be the owner's live meeting).
// Run: npx tsx scripts/verify-meeting-transcripts.mts   Safe to delete later.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, users } = await import("../src/db/schema");
const {
  createTranscript,
  listMeetingTranscripts,
  TRANSCRIPT_TYPE,
  TRANSCRIPT_RELATION_ROLE,
} = await import("../src/lib/meetings/transcripts");
const { listRelatedItems } = await import("../src/lib/relations");
const { queryViewItems } = await import("../src/lib/views");
const { ItemError } = await import("../src/lib/items");
const { updateItem } = await import("../src/lib/item-mutations");
const { eq, and } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
async function throws(name: string, fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    const ok = err instanceof ItemError && (!code || err.code === code);
    check(name, ok, err instanceof ItemError ? err.code : String(err));
  }
}

const db = getDb();
const [u1] = await db
  .insert(users)
  .values({ email: `verify-transcript-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const [u2] = await db
  .insert(users)
  .values({ email: `verify-transcript-other-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = u1.id;

const mk = async (v: Record<string, unknown>) =>
  (
    await db
      .insert(items)
      .values({ ownerId, ...(v as object) } as typeof items.$inferInsert)
      .returning({ id: items.id })
  )[0].id;

const meetingId = await mk({ type: "event", title: "Staff sync" });
const noteId = await mk({ type: "note", title: "A note" });

// --- create: child + edge + minutes=none ---------------------------------
const t1 = await createTranscript(ownerId, meetingId, {
  title: "Session 1",
  text: "alpha beta gamma delta",
});
check("transcript type is `transcript`", t1.type === TRANSCRIPT_TYPE, t1.type);
check("transcript parent is the meeting", t1.parentId === meetingId);
check(
  "minutes defaults to none",
  (t1.properties as Record<string, unknown> | null)?.minutes === "none",
  JSON.stringify(t1.properties)
);

const edge = await db
  .select({ role: relations.role, state: relations.matchState })
  .from(relations)
  .where(and(eq(relations.sourceId, meetingId), eq(relations.targetId, t1.id)));
check(
  "confirmed meeting→transcript edge with role `transcript`",
  edge.length === 1 && edge[0].role === TRANSCRIPT_RELATION_ROLE && edge[0].state === "confirmed",
  JSON.stringify(edge)
);

// --- MCP discovery: meeting → its transcripts is one hop ------------------
const related = await listRelatedItems(ownerId, meetingId);
const relT = related.find((r) => r.id === t1.id);
check(
  "get_item(meeting).related surfaces the transcript",
  !!relT && relT.roles.includes(TRANSCRIPT_RELATION_ROLE),
  JSON.stringify(relT?.roles)
);
const byRelated = await queryViewItems(ownerId, { type: TRANSCRIPT_TYPE, relatedTo: meetingId });
check(
  "list_items(type=transcript, relatedTo=meeting) finds it",
  byRelated.some((r) => r.id === t1.id)
);

// --- list + word count ----------------------------------------------------
const t2 = await createTranscript(ownerId, meetingId, { text: "" });
const summaries = await listMeetingTranscripts(ownerId, meetingId);
check("both transcripts listed for the meeting", summaries.length === 2);
const s1 = summaries.find((s) => s.id === t1.id)!;
const s2 = summaries.find((s) => s.id === t2.id)!;
check("word count counts words", s1.wordCount === 4, String(s1.wordCount));
check("empty transcript word count is 0", s2.wordCount === 0, String(s2.wordCount));
check("default title is Transcript", s2.title === "Transcript", s2.title);

// --- awaiting-minutes view: none in, draft/done out -----------------------
const awaiting = () =>
  queryViewItems(ownerId, {
    type: TRANSCRIPT_TYPE,
    propertyFilters: [{ key: "minutes", value: "none" }],
  });
let q = await awaiting();
check("awaiting-minutes shows both none transcripts", q.length === 2);

await updateItem(ownerId, t1.id, { propertyPatch: { minutes: "draft" } });
q = await awaiting();
check("draft transcript drops out of awaiting", !q.some((r) => r.id === t1.id) && q.length === 1);

await updateItem(ownerId, t2.id, { propertyPatch: { minutes: "done" } });
q = await awaiting();
check("done transcript drops out of awaiting", q.length === 0);

// --- guards ---------------------------------------------------------------
await throws("transcript on a note rejected", () => createTranscript(ownerId, noteId, { text: "x" }), "bad_request");
await throws("transcript on a missing meeting rejected", () => createTranscript(ownerId, crypto.randomUUID(), { text: "x" }), "not_found");
await throws("another owner's meeting is not found", () => createTranscript(u2.id, meetingId, { text: "x" }), "not_found");

// --- cleanup --------------------------------------------------------------
await db.delete(relations).where(eq(relations.sourceId, meetingId));
await db.delete(items).where(eq(items.ownerId, ownerId));
await db.delete(users).where(eq(users.id, ownerId));
await db.delete(users).where(eq(users.id, u2.id));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
