// Pin-as-rule (EM4, ADR-123). Turn a confirmed event→people match into a
// standing rule, ROUTED THROUGH A TEMPLATE: pinning creates (or updates) an
// `event` template that pre-relates the event's CONFIRMED people and carries a
// match condition with autoApply on, so future matching events apply it (Tier A
// in intake.ts). The owner can then edit the template to add recurring content.
//
// Only CONFIRMED people are captured (via getMeetingPeople) — not the still-
// pending suggestions — so a pin reflects exactly what the owner vouched for.
// (This is why pin does NOT use createTemplateFromItem, whose carryRelations
// would copy suggested edges as confirmed.)
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getItem, ItemError } from "@/lib/items";
import { getMeetingPeople } from "@/lib/meetings/prep";
import { relateItems } from "@/lib/relations";
import { createTemplate, getTemplate, updateTemplate } from "@/lib/templates";
import { validateMatchConfig } from "@/lib/templates/match-config";
import { listEventRules } from "@/lib/calendar/event-rules";
import type { MatcherCondition } from "@/lib/matchers/types";

type CalMeta = {
  attendees?: { email?: string | null }[];
  attendeeEmails?: string[];
  seriesMasterId?: string | null;
};

async function ownerEmail(ownerId: string): Promise<string | null> {
  const rows = await getDb().select({ email: users.email }).from(users).where(eq(users.id, ownerId));
  return rows[0]?.email?.toLowerCase() ?? null;
}

// The best default condition for an event item, preferring structured signals:
// a non-owner attendee email → that email; else the recurring series; else a
// fuzzy match on the title. The owner edits/overrides this before confirming.
export async function derivePinCondition(
  ownerId: string,
  eventItemId: string
): Promise<MatcherCondition> {
  const item = await getItem(ownerId, eventItemId);
  const cal = (item.properties as { calendar?: CalMeta } | null)?.calendar ?? {};
  const oe = await ownerEmail(ownerId);
  const emails = (cal.attendeeEmails ?? cal.attendees?.map((a) => a.email).filter((e): e is string => !!e) ?? [])
    .map((e) => e.toLowerCase())
    .filter((e) => e !== oe);
  if (emails.length > 0) return { kind: "attendeeEmail", email: emails[0] };
  if (cal.seriesMasterId) return { kind: "seriesId", seriesMasterId: cal.seriesMasterId };
  const title = (item.title ?? "").trim();
  if (title) return { kind: "titleFuzzy", pattern: title, threshold: 0.5 };
  throw new ItemError("bad_request", "can't derive a rule: the event has no attendee, series, or title");
}

function sameCondition(a: MatcherCondition, b: MatcherCondition): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "attendeeEmail":
      return a.email === (b as typeof a).email;
    case "seriesId":
      return a.seriesMasterId === (b as typeof a).seriesMasterId;
    case "titleRegex":
      return a.pattern === (b as typeof a).pattern && (a.flags ?? "") === ((b as typeof a).flags ?? "");
    case "titleFuzzy":
      return a.pattern === (b as typeof a).pattern;
  }
}

export type PinResult = { templateId: string; created: boolean; peopleAdded: number };

// Pin an event's confirmed match as a standing template rule. Create-or-update:
// if an existing event rule already carries the same condition, the confirmed
// people are added to it and it's (re)armed (autoApply on) — one template per
// standing meeting, never one per occurrence.
export async function pinEventAsTemplate(
  ownerId: string,
  eventItemId: string,
  opts: { condition?: MatcherCondition; name?: string } = {}
): Promise<PinResult> {
  const item = await getItem(ownerId, eventItemId); // ownership + existence
  if (item.deletedAt) throw new ItemError("bad_request", "can't pin a trashed event");
  if (item.isTemplate) throw new ItemError("bad_request", "this item is already a template");
  if (item.type !== "event") throw new ItemError("bad_request", "pin-as-rule is for events");

  // Validate a client-provided condition through the same gate the template uses
  // (lowercases an email, compiles a regex); else derive a sensible default.
  const condition = opts.condition
    ? validateMatchConfig({ condition: opts.condition, autoApply: true }).condition
    : await derivePinCondition(ownerId, eventItemId);

  const people = await getMeetingPeople(ownerId, eventItemId); // confirmed only

  async function addPeople(prototypeId: string): Promise<number> {
    let added = 0;
    for (const p of people) {
      try {
        await relateItems(ownerId, prototypeId, p.id);
        added++;
      } catch (err) {
        if (!(err instanceof ItemError)) throw err; // tolerate a vanished person
      }
    }
    return added;
  }

  // create-or-update guard.
  const existing = (await listEventRules(ownerId)).find((r) => sameCondition(r.condition, condition));
  if (existing) {
    const tmpl = await getTemplate(ownerId, existing.templateId);
    const peopleAdded = await addPeople(tmpl.prototypeItemId);
    await updateTemplate(ownerId, existing.templateId, { matchConfig: { condition, autoApply: true } });
    return { templateId: existing.templateId, created: false, peopleAdded };
  }

  const name = (opts.name?.trim() || item.title?.trim() || "Untitled event rule").slice(0, 120);
  const tmpl = await createTemplate(ownerId, { type: "event", name });
  const peopleAdded = await addPeople(tmpl.prototypeItemId);
  await updateTemplate(ownerId, tmpl.id, { matchConfig: { condition, autoApply: true } });
  return { templateId: tmpl.id, created: true, peopleAdded };
}
