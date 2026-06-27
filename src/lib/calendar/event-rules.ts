// Event match rules (EM1, ADR-123). Deterministic, no model in the loop: given a
// calendar event, find the owner's `event` template whose match rule recognizes
// it. This is the rule SOURCE that supersedes the (now-dormant) `matchers` table
// — the condition vocabulary and precedence are the matcher engine's, reused
// verbatim, but the rules live on templates (templates.match_config), so a
// confirmed-and-pinned match is just a template with a condition + the people
// pre-related on its prototype.
//
// Precedence is the engine's fixed kind order (attendeeEmail > seriesId >
// titleRegex > titleFuzzy); fuzzy is the last resort, only consulted when nothing
// more reliable matched. Ties within a kind go to the oldest template (stable,
// explainable). The matchers engine keeps its own copy of this evaluation until
// it is retired in EM3; both share the MatcherCondition contract.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, templates } from "@/db/schema";
import type { CalendarEvent } from "@/lib/calendar/types";
import { CONDITION_RANK, type MatcherCondition } from "@/lib/matchers/types";
import { parseMatchConfig } from "@/lib/templates/match-config";

// Calendar events promote to `event` items, so event templates are the rules.
export const EVENT_RULE_TYPE = "event";

export type EventRule = {
  templateId: string;
  templateName: string;
  condition: MatcherCondition;
  autoApply: boolean;
  createdAt: Date;
};

export type EventRuleMatch = { rule: EventRule };

function eventEmails(e: CalendarEvent): Set<string> {
  const s = new Set<string>();
  for (const a of e.attendees) if (a.email) s.add(a.email.toLowerCase());
  if (e.organizer?.email) s.add(e.organizer.email.toLowerCase());
  return s;
}

function regexMatches(pattern: string, flags: string | undefined, title: string): boolean {
  try {
    return new RegExp(pattern, flags).test(title);
  } catch {
    // A bad pattern is rejected at save time; a legacy one is a non-match here,
    // never a mid-match throw.
    return false;
  }
}

// The structured (non-fuzzy) conditions test synchronously against the event.
function nonFuzzyMatches(
  condition: MatcherCondition,
  event: CalendarEvent,
  emails: Set<string>
): boolean {
  switch (condition.kind) {
    case "attendeeEmail":
      return emails.has(condition.email.toLowerCase());
    case "seriesId":
      return !!event.seriesMasterId && event.seriesMasterId === condition.seriesMasterId;
    case "titleRegex":
      return regexMatches(condition.pattern, condition.flags, event.title);
    case "titleFuzzy":
      return false; // handled async + gated below
  }
}

// pg_trgm similarity for a fuzzy title rule (threshold defaults to pg_trgm's 0.3).
async function fuzzyTitleHit(
  title: string,
  condition: Extract<MatcherCondition, { kind: "titleFuzzy" }>
): Promise<boolean> {
  const threshold = condition.threshold ?? 0.3;
  const res = await getDb().execute(
    sql`select similarity(lower(${title}), lower(${condition.pattern})) >= ${threshold} as hit`
  );
  return (res.rows[0] as { hit: boolean } | undefined)?.hit === true;
}

// The owner's event templates that carry a match rule (live prototype only,
// index-backed by templates_match_idx).
export async function listEventRules(ownerId: string): Promise<EventRule[]> {
  const rows = await getDb()
    .select({
      id: templates.id,
      name: templates.name,
      matchConfig: templates.matchConfig,
      createdAt: templates.createdAt,
    })
    .from(templates)
    .innerJoin(items, eq(items.id, templates.prototypeItemId))
    .where(
      and(
        eq(templates.ownerId, ownerId),
        eq(templates.type, EVENT_RULE_TYPE),
        isNull(items.deletedAt),
        sql`${templates.matchConfig} is not null`
      )
    )
    .orderBy(asc(templates.createdAt));
  const rules: EventRule[] = [];
  for (const r of rows) {
    const mc = parseMatchConfig(r.matchConfig);
    if (!mc) continue; // a garbled blob reads as "no rule"
    rules.push({
      templateId: r.id,
      templateName: r.name,
      condition: mc.condition,
      autoApply: mc.autoApply,
      createdAt: r.createdAt,
    });
  }
  return rules;
}

// The single best template rule for an event, in fixed kind precedence (fuzzy
// gated), oldest-template tie-break. null = no rule recognizes this event.
export async function matchEventToTemplate(
  ownerId: string,
  event: CalendarEvent
): Promise<EventRuleMatch | null> {
  const rules = await listEventRules(ownerId);
  if (rules.length === 0) return null;
  const emails = eventEmails(event);

  const nonFuzzyHits: EventRule[] = [];
  const fuzzyCandidates: EventRule[] = [];
  for (const rule of rules) {
    if (rule.condition.kind === "titleFuzzy") fuzzyCandidates.push(rule);
    else if (nonFuzzyMatches(rule.condition, event, emails)) nonFuzzyHits.push(rule);
  }

  // Fuzzy is the last resort: only when nothing more reliable matched.
  let hits = nonFuzzyHits;
  if (nonFuzzyHits.length === 0 && fuzzyCandidates.length > 0) {
    const hitting: EventRule[] = [];
    for (const c of fuzzyCandidates) {
      if (c.condition.kind === "titleFuzzy" && (await fuzzyTitleHit(event.title, c.condition))) {
        hitting.push(c);
      }
    }
    hits = hitting;
  }
  if (hits.length === 0) return null;

  hits.sort(
    (a, b) =>
      CONDITION_RANK[a.condition.kind] - CONDITION_RANK[b.condition.kind] ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
  return { rule: hits[0] };
}
