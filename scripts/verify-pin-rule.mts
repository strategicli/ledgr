// EM4 (ADR-123) verification: pin-as-rule. derivePinCondition (attendee email →
// series → title, owner-excluded), pinEventAsTemplate (creates an event template
// carrying ONLY the confirmed people + a matchConfig with autoApply; create-or-
// update guard; guards), and the end-to-end loop (pin, then a new matching event
// applies the rule via intake Tier A). Against live Neon under a throwaway owner.
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/verify-pin-rule.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, relations, templates, users } = await import("../src/db/schema");
const { ItemError } = await import("../src/lib/items");
const {
  createItem,
  softDeleteItem,
} = await import("../src/lib/item-mutations");
const { relateItems, addMatchEdge } = await import("../src/lib/relations");
const { getTemplate } = await import("../src/lib/templates");
const { getMeetingPeople } = await import("../src/lib/meetings/prep");
const { derivePinCondition, pinEventAsTemplate } = await import("../src/lib/templates/pin");
const { applyEventIntake } = await import("../src/lib/calendar/intake");
const { eq } = await import("drizzle-orm");

type CalendarEvent = import("../src/lib/calendar/types").CalendarEvent;
function ev(p: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`, title: "", startUtc: new Date(),
    endUtc: null, isCancelled: false, organizer: null, attendees: [], location: null,
    isOnline: false, joinUrl: null, webLink: null, seriesMasterId: null, bodyPreview: null,
    lastModified: null, ...p,
  };
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
async function throws(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false, "did not throw"); }
  catch (err) { check(name, err instanceof ItemError && (!code || err.code === code), err instanceof Error ? err.message : String(err)); }
}
async function protoTargets(prototypeItemId: string): Promise<string[]> {
  const rows = await getDb().select({ t: relations.targetId }).from(relations).where(eq(relations.sourceId, prototypeItemId));
  return rows.map((r) => r.t);
}

const stamp = Date.now();
const db = getDb();
const ownerEmail = `verify-pin-${stamp}@example.invalid`;
const [owner] = await db.insert(users).values({ email: ownerEmail }).returning({ id: users.id });

try {
  const pat = await createItem(owner.id, { type: "person", title: "Pat Staff", properties: { email: "pat@x.com" } });
  const sam = await createItem(owner.id, { type: "person", title: "Sam Suggested" });

  // Event with the owner + Pat as attendees → derive should pick Pat (owner skipped).
  const cal = { attendees: [{ name: "Me", email: ownerEmail }, { name: "Pat", email: "pat@x.com" }], attendeeEmails: [ownerEmail, "pat@x.com"], seriesMasterId: null };
  const event = await createItem(owner.id, { type: "event", title: "Pat / Brandon 1:1", properties: { calendar: cal } });
  await relateItems(owner.id, event.id, pat.id); // confirmed
  await addMatchEdge(owner.id, event.id, sam.id, "suggested"); // suggested (must NOT be pinned)

  // --- derivePinCondition: owner-excluded attendee email wins ---
  const cond = await derivePinCondition(owner.id, event.id);
  check("derive picks the non-owner attendee email", cond.kind === "attendeeEmail" && (cond as { email: string }).email === "pat@x.com");

  // --- pin creates a template with ONLY the confirmed person + autoApply rule ---
  const r1 = await pinEventAsTemplate(owner.id, event.id);
  check("pin creates a new template", r1.created === true && !!r1.templateId);
  check("pin adds the confirmed person", r1.peopleAdded === 1);
  const t1 = await getTemplate(owner.id, r1.templateId);
  check("the template carries the match rule (autoApply on)", t1.matchConfig?.condition.kind === "attendeeEmail" && t1.matchConfig.autoApply === true);
  check("the template type is event", t1.type === "event");
  const targets = await protoTargets(t1.prototypeItemId);
  check("the prototype pre-relates the CONFIRMED person (Pat)", targets.includes(pat.id));
  check("the prototype does NOT relate the SUGGESTED person (Sam)", !targets.includes(sam.id));

  // --- create-or-update: pinning the same condition reuses the template ---
  const r2 = await pinEventAsTemplate(owner.id, event.id);
  check("re-pinning the same condition updates, not duplicates", r2.created === false && r2.templateId === r1.templateId);
  const allEventTemplates = await db.select({ id: templates.id }).from(templates).where(eq(templates.ownerId, owner.id));
  check("only one template exists for the condition", allEventTemplates.length === 1);

  // --- derive fallbacks: no email → series; no series → title fuzzy ---
  const seriesEvent = await createItem(owner.id, { type: "event", title: "Staff", properties: { calendar: { attendees: [], attendeeEmails: [], seriesMasterId: "series-xyz" } } });
  check("derive falls back to seriesId", (await derivePinCondition(owner.id, seriesEvent.id)).kind === "seriesId");
  const titleEvent = await createItem(owner.id, { type: "event", title: "Elders Huddle", properties: { calendar: { attendees: [], attendeeEmails: [], seriesMasterId: null } } });
  const tcond = await derivePinCondition(owner.id, titleEvent.id);
  check("derive falls back to titleFuzzy on the title", tcond.kind === "titleFuzzy" && (tcond as { pattern: string }).pattern === "Elders Huddle");

  // --- explicit condition override is honored + validated ---
  const r3 = await pinEventAsTemplate(owner.id, seriesEvent.id, { condition: { kind: "seriesId", seriesMasterId: "series-xyz" }, name: "Staff series rule" });
  check("explicit condition is used", (await getTemplate(owner.id, r3.templateId)).matchConfig?.condition.kind === "seriesId");
  await throws("pin rejects a bad explicit condition", () => pinEventAsTemplate(owner.id, titleEvent.id, { condition: { kind: "attendeeEmail", email: "nope" } as never }), "bad_request");

  // --- guards ---
  const note = await createItem(owner.id, { type: "note", title: "not an event" });
  await throws("pin rejects a non-event item", () => pinEventAsTemplate(owner.id, note.id), "bad_request");
  const trashed = await createItem(owner.id, { type: "event", title: "trashed", properties: { calendar: { attendeeEmails: ["x@y.com"] } } });
  await softDeleteItem(owner.id, trashed.id);
  await throws("pin rejects a trashed event", () => pinEventAsTemplate(owner.id, trashed.id), "bad_request");

  // --- the loop closes: a NEW matching event applies the pinned rule (Tier A) ---
  const future = await createItem(owner.id, { type: "event", title: "Pat / Brandon 1:1 (next week)" });
  const intake = await applyEventIntake(owner.id, future.id, ev({ title: "Pat / Brandon 1:1 (next week)", attendees: [{ name: "Pat", email: "pat@x.com" }] }));
  check("a new matching event is recognized (Tier A)", intake.tier === "recognized" && intake.templateId === r1.templateId);
  check("the pinned person auto-fills as confirmed on the new event", (await getMeetingPeople(owner.id, future.id)).some((p) => p.id === pat.id));

  // --- owner-scoped ---
  const [other] = await db.insert(users).values({ email: `verify-pin-other-${stamp}@example.invalid` }).returning({ id: users.id });
  await throws("pin is owner-scoped (foreign event)", () => pinEventAsTemplate(other.id, event.id), "not_found");
  await db.delete(items).where(eq(items.ownerId, other.id));
  await db.delete(users).where(eq(users.id, other.id));
} finally {
  await db.delete(items).where(eq(items.ownerId, owner.id));
  await db.delete(templates).where(eq(templates.ownerId, owner.id));
  await db.delete(users).where(eq(users.id, owner.id));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
