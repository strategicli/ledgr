// Slice 23 verification: the matcher engine + store + match-edge writer,
// against the live Neon DB (real pg_trgm similarity) under a throwaway owner.
// Covers condition kinds, kind precedence, fuzzy-as-last-resort gating,
// confirmed-wins accumulation, save-time validation, edge writing with the
// right match_state, no-downgrade of a confirmed edge, properties.match
// recording, and owner scoping. Run: npx tsx scripts/verify-matchers.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, matchers, relations, users } = await import("../src/db/schema");
const { createMatcher, listMatchers, deleteMatcher } = await import("../src/lib/matchers/store");
const { matchEvent, applyMatchersToMeeting } = await import("../src/lib/matchers/engine");
const { ItemError } = await import("../src/lib/items");
type CalendarEvent = import("../src/lib/calendar/types").CalendarEvent;
const { and, eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();

function ev(over: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    id: over.id,
    title: over.title ?? "Untitled",
    startUtc: over.startUtc ?? new Date("2026-06-20T15:00:00Z"),
    endUtc: over.endUtc ?? null,
    isCancelled: over.isCancelled ?? false,
    organizer: over.organizer ?? null,
    attendees: over.attendees ?? [],
    location: over.location ?? null,
    isOnline: over.isOnline ?? false,
    joinUrl: over.joinUrl ?? null,
    webLink: over.webLink ?? null,
    seriesMasterId: over.seriesMasterId ?? null,
    bodyPreview: over.bodyPreview ?? null,
    lastModified: over.lastModified ?? null,
  };
}

const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-matchers-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

const mkPerson = async (title: string) =>
  (await db.insert(items).values({ ownerId, type: "person", title }).returning({ id: items.id }))[0].id;

const relState = async (sourceId: string, targetId: string) =>
  (
    await db
      .select({ matchState: relations.matchState })
      .from(relations)
      .where(and(eq(relations.sourceId, sourceId), eq(relations.targetId, targetId)))
  )[0]?.matchState ?? null;

try {
  const roger = await mkPerson("Roger");
  const staff = await mkPerson("Staff Team");
  const vision = await mkPerson("Vision");

  // --- save-time validation -----------------------------------------------
  let rejectedBadRegex = false;
  try {
    await createMatcher(ownerId, { condition: { kind: "titleRegex", pattern: "(" } as never, action: {} });
  } catch (err) {
    rejectedBadRegex = err instanceof ItemError;
  }
  check("createMatcher rejects an invalid regex at save time", rejectedBadRegex);

  // --- rules ---------------------------------------------------------------
  const mAttendee = await createMatcher(ownerId, { priority: 5, condition: { kind: "attendeeEmail", email: "roger@example.invalid" }, action: { entityIds: [roger], templateName: "roger-1on1" } });
  const mSeries = await createMatcher(ownerId, { priority: 1, condition: { kind: "seriesId", seriesMasterId: "series-vision" }, action: { entityIds: [vision] } });
  const mRegex = await createMatcher(ownerId, { priority: 2, condition: { kind: "titleRegex", pattern: "staff", flags: "i" }, action: { entityIds: [staff] } });
  const mFuzzyVision = await createMatcher(ownerId, { priority: 9, condition: { kind: "titleFuzzy", pattern: "Vision Retreat", threshold: 0.3 }, action: { entityIds: [vision] } });
  const mFuzzyGated = await createMatcher(ownerId, { priority: 9, condition: { kind: "titleFuzzy", pattern: "Weekly Staff Sync", threshold: 0.2 }, action: { entityIds: [roger] } });
  const mSeriesRoger = await createMatcher(ownerId, { priority: 1, condition: { kind: "seriesId", seriesMasterId: "series-roger" }, action: { entityIds: [roger] } });

  const all = await listMatchers(ownerId);
  check("listMatchers returns all rules ordered by priority", all.length === 6 && all[0].priority <= all[all.length - 1].priority);

  // --- matchEvent: attendee email (suggested), fuzzy not fired ------------
  const r1 = await matchEvent(ownerId, ev({ id: "e1", title: "1:1", attendees: [{ name: "Roger", email: "roger@example.invalid" }] }));
  check("attendee-email match attaches the entity as suggested", r1.entities.length === 1 && r1.entities[0].entityId === roger && r1.entities[0].matchState === "suggested");
  check("attendee match carries the template name", r1.templateName === "roger-1on1");
  check("attendee match does not consult fuzzy", !r1.matchedMatcherIds.includes(mFuzzyVision.id) && !r1.matchedMatcherIds.includes(mFuzzyGated.id));

  // --- series id (confirmed) ----------------------------------------------
  const r2 = await matchEvent(ownerId, ev({ id: "e2", title: "Anything", seriesMasterId: "series-vision" }));
  check("series-id match attaches the entity as confirmed", r2.entities.length === 1 && r2.entities[0].entityId === vision && r2.entities[0].matchState === "confirmed");

  // --- title regex (confirmed) --------------------------------------------
  const r3 = await matchEvent(ownerId, ev({ id: "e3", title: "Weekly STAFF gathering" }));
  check("title-regex match (case-insensitive) attaches confirmed", r3.entities.some((x) => x.entityId === staff && x.matchState === "confirmed"));

  // --- fuzzy is the last resort, and gated by any non-fuzzy hit -----------
  const r4 = await matchEvent(ownerId, ev({ id: "e4", title: "Vision Retreat" }));
  check("fuzzy fires when nothing more reliable matched", r4.entities.some((x) => x.entityId === vision) && r4.matchedMatcherIds.includes(mFuzzyVision.id));

  const r5 = await matchEvent(ownerId, ev({ id: "e5", title: "Weekly Staff Sync" }));
  check("fuzzy is gated when a regex rule already matched (only Staff, not Roger)", r5.entities.length === 1 && r5.entities[0].entityId === staff && !r5.matchedMatcherIds.includes(mFuzzyGated.id));

  // --- confirmed wins when two rules target the same entity ----------------
  const r6 = await matchEvent(ownerId, ev({ id: "e6", title: "1:1", seriesMasterId: "series-roger", attendees: [{ name: "Roger", email: "roger@example.invalid" }] }));
  const rogerEdge = r6.entities.find((x) => x.entityId === roger);
  check("confirmed wins over suggested for the same entity", rogerEdge?.matchState === "confirmed");

  // --- no match ------------------------------------------------------------
  const r7 = await matchEvent(ownerId, ev({ id: "e7", title: "Completely unrelated lunch" }));
  check("no rule matches -> empty result", r7.entities.length === 0 && r7.matchedMatcherIds.length === 0);

  // --- applyMatchersToMeeting writes edges + records template -------------
  const meeting = (await db.insert(items).values({ ownerId, type: "meeting", title: "Roger 1:1", msEventId: "evt-apply" }).returning({ id: items.id }))[0].id;
  const applied = await applyMatchersToMeeting(ownerId, meeting, ev({ id: "evt-apply", title: "Roger 1:1", attendees: [{ name: "Roger", email: "roger@example.invalid" }] }));
  check("apply writes the suggested entity edge", applied.edges === 1 && (await relState(meeting, roger)) === "suggested");
  const props = (await db.select({ properties: items.properties }).from(items).where(eq(items.id, meeting)))[0].properties as { match?: { templateName?: string; matcherIds?: string[] } };
  check("apply records matched template + matcher ids in properties.match", props.match?.templateName === "roger-1on1" && (props.match?.matcherIds ?? []).includes(mAttendee.id));

  // --- no-downgrade of an already-confirmed edge --------------------------
  const meeting2 = (await db.insert(items).values({ ownerId, type: "meeting", title: "Confirmed already", msEventId: "evt-confirmed" }).returning({ id: items.id }))[0].id;
  await db.insert(relations).values({ sourceId: meeting2, targetId: roger, role: "related", matchState: "confirmed" });
  await applyMatchersToMeeting(ownerId, meeting2, ev({ id: "evt-confirmed", title: "x", attendees: [{ name: "Roger", email: "roger@example.invalid" }] }));
  check("a suggested auto-match never downgrades a confirmed edge", (await relState(meeting2, roger)) === "confirmed");

  // --- delete + owner scoping ---------------------------------------------
  const del = await deleteMatcher(ownerId, mSeriesRoger.id);
  check("deleteMatcher removes the owner's rule", del.deleted === 1 && (await listMatchers(ownerId)).length === 5);
  const wrongOwnerDel = await deleteMatcher(ownerId, "00000000-0000-0000-0000-000000000000");
  check("deleteMatcher is a no-op for a non-existent id", wrongOwnerDel.deleted === 0);
} finally {
  await db.delete(matchers).where(eq(matchers.ownerId, ownerId));
  // Deleting the owner's items cascades their relations/attachments/revisions.
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
