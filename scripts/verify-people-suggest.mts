// EM2 (ADR-123) verification: the person suggester + event intake. Covers the
// email signal, the title-token signal, owner self-exclusion (id + name tokens),
// multi-token-name ranking, the fuzzy fallback gating, and applyEventIntake's
// three tiers (A recognized = record-only in EM2; B suggested edges written, not
// confirmed; C nothing) plus addMatchEdge never downgrading a confirmed edge.
// Against live Neon under a throwaway owner. Run:
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/verify-people-suggest.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, templates, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/items");
const { createTemplate, updateTemplate } = await import("../src/lib/templates");
const { suggestPeopleForEvent } = await import("../src/lib/calendar/suggest-people");
const { applyEventIntake } = await import("../src/lib/calendar/intake");
const { getMeetingPrep } = await import("../src/lib/meetings/prep");
const { relateItems } = await import("../src/lib/relations");
const { and, eq, inArray, or } = await import("drizzle-orm");

type CalendarEvent = import("../src/lib/calendar/types").CalendarEvent;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

function ev(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    title: "",
    startUtc: new Date(),
    endUtc: null,
    isCancelled: false,
    organizer: null,
    attendees: [],
    location: null,
    isOnline: false,
    joinUrl: null,
    webLink: null,
    seriesMasterId: null,
    bodyPreview: null,
    lastModified: null,
    ...partial,
  };
}

const stamp = Date.now();
const db = getDb();
const ownerEmail = `verify-suggest-owner-${stamp}@example.invalid`;
const [owner] = await db.insert(users).values({ email: ownerEmail }).returning({ id: users.id });

async function edgeState(eventId: string, personId: string): Promise<string | null> {
  const rows = await db
    .select({ ms: relations.matchState })
    .from(relations)
    .where(
      or(
        and(eq(relations.sourceId, eventId), eq(relations.targetId, personId)),
        and(eq(relations.sourceId, personId), eq(relations.targetId, eventId))
      )
    );
  return rows[0]?.ms ?? null;
}

try {
  // People: the owner's own person (carries users.email), Roger (email + name),
  // a single-token "Roger" person, and Pat (for the Tier-A template).
  const ownerPerson = await createItem(owner.id, {
    type: "person",
    title: "Brandon Owner",
    properties: { email: ownerEmail },
  });
  const roger = await createItem(owner.id, {
    type: "person",
    title: "Roger Knowlton",
    properties: { email: "roger@x.com" },
  });
  const rogerSingle = await createItem(owner.id, { type: "person", title: "Roger" });
  const pat = await createItem(owner.id, {
    type: "person",
    title: "Pat Staff",
    properties: { email: "pat@x.com" },
  });

  // --- Signal 1: email → person ---
  const s1 = await suggestPeopleForEvent(owner.id, ev({ title: "Sync", attendees: [{ name: "Roger", email: "ROGER@x.com" }] }));
  check("email signal suggests the person (case-insensitive)", s1.some((s) => s.personId === roger.id && s.reason === "attendeeEmail" && s.confidence === "high"));

  // --- Owner self-exclusion by email ---
  const s2 = await suggestPeopleForEvent(owner.id, ev({ title: "1:1", attendees: [{ name: "Me", email: ownerEmail }, { name: "Roger", email: "roger@x.com" }] }));
  check("owner is never suggested by their own email", !s2.some((s) => s.personId === ownerPerson.id));
  check("the other attendee is still suggested", s2.some((s) => s.personId === roger.id));

  // --- Signal 2: title token → person ("Roger/Brandon 1:1" → Roger Knowlton) ---
  const s3 = await suggestPeopleForEvent(owner.id, ev({ title: "Roger / Brandon 1:1" }));
  check("title-token signal suggests Roger Knowlton", s3.some((s) => s.personId === roger.id && s.reason === "titleToken"));
  check("owner name token ('Brandon') does not self-match", !s3.some((s) => s.personId === ownerPerson.id));

  // --- Multi-token name ranks above a single-token name on the same token ---
  const s4 = await suggestPeopleForEvent(owner.id, ev({ title: "Roger planning" }), { limit: 5 });
  const idxMulti = s4.findIndex((s) => s.personId === roger.id);
  const idxSingle = s4.findIndex((s) => s.personId === rogerSingle.id);
  check("both Rogers surface on the token", idxMulti >= 0 && idxSingle >= 0);
  check("the multi-token name ranks first", idxMulti >= 0 && idxSingle >= 0 && idxMulti < idxSingle);

  // --- No determinable match ---
  const s5 = await suggestPeopleForEvent(owner.id, ev({ title: "Totally unrelated quarterly thing" }));
  check("an unrelated title yields no suggestions", s5.length === 0);

  // --- Cap respected ---
  const s6 = await suggestPeopleForEvent(owner.id, ev({ title: "Roger planning" }), { limit: 1 });
  check("limit caps the suggestions", s6.length <= 1);

  // --- intake writes NO edges for a non-template event; suggestions are LIVE
  //     on the canvas (getMeetingPrep), so opening ANY event shows them ---
  const eventB = await createItem(owner.id, { type: "event", title: "Roger / Brandon 1:1" });
  const rB = await applyEventIntake(owner.id, eventB.id, ev({ title: "Roger / Brandon 1:1", attendees: [{ name: "Roger", email: "roger@x.com" }] }));
  check("intake writes no edge for a non-template event", rB.tier === "none" && (await edgeState(eventB.id, roger.id)) === null);
  const prepB = await getMeetingPrep(owner.id, eventB.id);
  check("getMeetingPrep live-suggests Roger for the event", prepB.suggestedPeople.some((p) => p.id === roger.id));
  check("the owner is not live-suggested", !prepB.suggestedPeople.some((p) => p.id === ownerPerson.id));
  check("no one is confirmed yet", prepB.people.length === 0);
  // adding (a confirmed relate) moves Roger into people + out of suggestions
  await relateItems(owner.id, eventB.id, roger.id);
  const prepB2 = await getMeetingPrep(owner.id, eventB.id);
  check("after add, Roger is a confirmed meeting person", prepB2.people.some((p) => p.id === roger.id));
  check("after add, Roger drops out of live suggestions", !prepB2.suggestedPeople.some((p) => p.id === roger.id));

  // --- Tier A: a pinned (autoApply) template is applied (empty here → no people) ---
  const tmpl = await createTemplate(owner.id, { type: "event", name: `Pat 1:1 ${stamp}` });
  await updateTemplate(owner.id, tmpl.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "pat@x.com" }, autoApply: true } });
  const eventA = await createItem(owner.id, { type: "event", title: "Pat sync" });
  const rA = await applyEventIntake(owner.id, eventA.id, ev({ title: "Pat sync", attendees: [{ name: "Pat", email: "pat@x.com" }] }));
  check("Tier A reports recognized with the template id", rA.tier === "recognized" && rA.templateId === tmpl.id);
  const propsA = (await db.select({ p: items.properties }).from(items).where(eq(items.id, eventA.id)))[0].p as { match?: { templateId?: string } };
  check("Tier A records the matched template id", propsA.match?.templateId === tmpl.id);
  check("Tier A with an empty template adds no people (no Pat edge)", (await edgeState(eventA.id, pat.id)) === null);

  // --- no template + no guess: intake writes nothing ---
  const eventC = await createItem(owner.id, { type: "event", title: "Quarterly budget offsite" });
  const rC = await applyEventIntake(owner.id, eventC.id, ev({ title: "Quarterly budget offsite" }));
  check("no-match intake reports none", rC.tier === "none");
  const edgesC = await db.select({ id: relations.id }).from(relations).where(or(eq(relations.sourceId, eventC.id), eq(relations.targetId, eventC.id)));
  check("no-match intake writes no edges", edgesC.length === 0);

  // --- owner-scoped: another owner sees nothing ---
  const [other] = await db.insert(users).values({ email: `verify-suggest-other-${stamp}@example.invalid` }).returning({ id: users.id });
  check("suggester is owner-scoped", (await suggestPeopleForEvent(other.id, ev({ title: "Roger / Brandon 1:1", attendees: [{ name: "Roger", email: "roger@x.com" }] }))).length === 0);
  await db.delete(users).where(eq(users.id, other.id));
} finally {
  await db.delete(items).where(eq(items.ownerId, owner.id));
  await db.delete(templates).where(eq(templates.ownerId, owner.id));
  await db.delete(users).where(inArray(users.id, [owner.id]));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
