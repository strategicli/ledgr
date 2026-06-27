// EM3 (ADR-123) verification: Tier-A template auto-apply on intake. A pinned
// (autoApply) event template whose condition matches applies on Add — its
// pre-related people land as CONFIRMED edges (flowing into prep) and its
// recurring content (body + subtasks) is copied on. A dormant (autoApply:false)
// rule does NOT apply — intake falls through to suggestions. Against live Neon
// under a throwaway owner. Run:
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/verify-event-template-apply.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, templates, users } = await import("../src/db/schema");
const { createItem, getItem, updateItem } = await import("../src/lib/items");
const { createTemplate, updateTemplate } = await import("../src/lib/templates");
const { relateItems } = await import("../src/lib/relations");
const { applyEventIntake } = await import("../src/lib/calendar/intake");
const { getMeetingPeople, getMeetingPrep } = await import("../src/lib/meetings/prep");
const { and, eq, or } = await import("drizzle-orm");

type CalendarEvent = import("../src/lib/calendar/types").CalendarEvent;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function ev(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`, title: "", startUtc: new Date(),
    endUtc: null, isCancelled: false, organizer: null, attendees: [], location: null,
    isOnline: false, joinUrl: null, webLink: null, seriesMasterId: null,
    bodyPreview: null, lastModified: null, ...partial,
  };
}

const stamp = Date.now();
const db = getDb();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-tmpl-apply-${stamp}@example.invalid` })
  .returning({ id: users.id });

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
  const pat = await createItem(owner.id, { type: "person", title: "Pat Staff", properties: { email: "pat@x.com" } });

  // --- author a pinned template: Pat pre-related (confirmed), body + a subtask ---
  const tmpl = await createTemplate(owner.id, { type: "event", name: `Pat 1:1 ${stamp}` });
  await updateItem(owner.id, tmpl.prototypeItemId, {
    body: { format: "markdown", text: "## Agenda\n\n- Pastoral check-in\n- Prayer" },
  });
  await relateItems(owner.id, tmpl.prototypeItemId, pat.id);
  await createItem(owner.id, { type: "event", title: "Recurring sub", parentId: tmpl.prototypeItemId });
  await updateTemplate(owner.id, tmpl.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "pat@x.com" }, autoApply: true } });

  // --- Tier A: a matching event applies the template ---
  const eventA = await createItem(owner.id, { type: "event", title: "Pat sync" });
  const rA = await applyEventIntake(owner.id, eventA.id, ev({ title: "Pat sync", attendees: [{ name: "Pat", email: "pat@x.com" }] }));
  check("Tier A reports recognized", rA.tier === "recognized" && rA.templateId === tmpl.id);
  check("the template's person is now a CONFIRMED edge", (await edgeState(eventA.id, pat.id)) === "confirmed");
  check("the confirmed person flows into meeting people", (await getMeetingPeople(owner.id, eventA.id)).some((p) => p.id === pat.id));
  const aFull = await getItem(owner.id, eventA.id);
  check("the template body is applied (event had none)", (aFull.body as { text?: string } | null)?.text?.includes("Pastoral check-in") === true);
  const aKids = await db.select({ title: items.title }).from(items).where(and(eq(items.parentId, eventA.id), eq(items.ownerId, owner.id)));
  check("the template subtask is cloned onto the event", aKids.length === 1 && aKids[0].title === "Recurring sub");
  const aProps = (await db.select({ p: items.properties }).from(items).where(eq(items.id, eventA.id)))[0].p as { match?: { templateId?: string; templateName?: string } };
  check("properties.match records the applied template", aProps.match?.templateId === tmpl.id);
  const prep = await getMeetingPrep(owner.id, eventA.id);
  check("getMeetingPrep surfaces the template name for display", prep.templateName === tmpl.name);

  // --- a dormant (autoApply:false) rule does NOT apply — falls to suggestions ---
  const dom = await createItem(owner.id, { type: "person", title: "Dana Dormant", properties: { email: "dana@x.com" } });
  const domTmpl = await createTemplate(owner.id, { type: "event", name: `Dana dormant ${stamp}` });
  await updateItem(owner.id, domTmpl.prototypeItemId, { body: { format: "markdown", text: "## Dormant agenda" } });
  await relateItems(owner.id, domTmpl.prototypeItemId, dom.id);
  await updateTemplate(owner.id, domTmpl.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "dana@x.com" }, autoApply: false } });
  const eventD = await createItem(owner.id, { type: "event", title: "Dana sync" });
  const rD = await applyEventIntake(owner.id, eventD.id, ev({ title: "Dana sync", attendees: [{ name: "Dana", email: "dana@x.com" }] }));
  check("a dormant rule is not applied (tier none)", rD.tier === "none");
  check("dormant rule: no edge is written at intake", (await edgeState(eventD.id, dom.id)) === null);
  const dFull = await getItem(owner.id, eventD.id);
  check("dormant rule: the template body is NOT applied", !((dFull.body as { text?: string } | null)?.text ?? "").includes("Dormant agenda"));
  const prepD = await getMeetingPrep(owner.id, eventD.id);
  check("dormant rule: the person is live-suggested on the canvas instead", prepD.suggestedPeople.some((p) => p.id === dom.id));
} finally {
  await db.delete(items).where(eq(items.ownerId, owner.id));
  await db.delete(templates).where(eq(templates.ownerId, owner.id));
  await db.delete(users).where(eq(users.id, owner.id));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
