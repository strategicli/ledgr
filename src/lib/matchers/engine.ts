// DORMANT as of EM3 (ADR-123): the calendar rule SOURCE moved off the `matchers`
// table onto templates (`templates.match_config`; see src/lib/calendar/
// event-rules.ts + intake.ts). `matchEvent`/`applyMatchersToMeeting` are no
// longer called by any live path (feed Add + both sync routes use applyEventIntake).
// Left in place, not deleted (defer-by-hiding, reversible; the table is empty).
// The condition VOCABULARY (MatcherCondition / CONDITION_RANK / defaultMatchState
// in ./types, validateCondition in ./store) is still shared and very much in use.
//
// Matcher engine (slice 23, PRD §5.1). Deterministic, no model in the loop:
// given a calendar event, evaluate the owner's rules in kind precedence
// (attendee-email -> series-id -> title-regex -> fuzzy) and return the entities
// to attach (with trust), the chosen template, and a default urgency. Fuzzy
// (pg_trgm similarity) is the last resort: it only fires when no higher-rank
// rule matched (external guests, room-only invites).
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import type { CalendarEvent } from "@/lib/calendar/types";
import { addMatchEdge } from "@/lib/relations";
import { listMatchers } from "./store";
import {
  CONDITION_RANK,
  defaultMatchState,
  type Matcher,
  type MatchResult,
} from "./types";

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
    // A bad pattern was rejected at save time; if a legacy one slips through,
    // treat it as a non-match rather than throwing mid-sync.
    return false;
  }
}

// pg_trgm similarity for the fuzzy candidates. One small query per fuzzy rule
// (they are few and fuzzy is the rare last resort); returns the ids that clear
// their threshold.
async function fuzzyHitIds(title: string, fuzzy: Matcher[]): Promise<Set<string>> {
  const hits = new Set<string>();
  for (const m of fuzzy) {
    if (m.condition.kind !== "titleFuzzy") continue;
    const threshold = m.condition.threshold ?? 0.3;
    const res = await getDb().execute(
      sql`select similarity(lower(${title}), lower(${m.condition.pattern})) >= ${threshold} as hit`
    );
    if ((res.rows[0] as { hit: boolean } | undefined)?.hit) hits.add(m.id);
  }
  return hits;
}

export async function matchEvent(
  ownerId: string,
  event: CalendarEvent
): Promise<MatchResult> {
  const all = await listMatchers(ownerId);
  const emails = eventEmails(event);

  const nonFuzzyHits: Matcher[] = [];
  const fuzzyCandidates: Matcher[] = [];
  for (const m of all) {
    const c = m.condition;
    switch (c.kind) {
      case "attendeeEmail":
        if (emails.has(c.email.toLowerCase())) nonFuzzyHits.push(m);
        break;
      case "seriesId":
        if (event.seriesMasterId && event.seriesMasterId === c.seriesMasterId) {
          nonFuzzyHits.push(m);
        }
        break;
      case "titleRegex":
        if (regexMatches(c.pattern, c.flags, event.title)) nonFuzzyHits.push(m);
        break;
      case "titleFuzzy":
        fuzzyCandidates.push(m);
        break;
    }
  }

  // Fuzzy is the last resort: only consulted when nothing more reliable hit.
  let hits = nonFuzzyHits;
  if (nonFuzzyHits.length === 0 && fuzzyCandidates.length > 0) {
    const ids = await fuzzyHitIds(event.title, fuzzyCandidates);
    hits = fuzzyCandidates.filter((m) => ids.has(m.id));
  }

  // Most reliable kind first, then user priority — so the winner of any tie
  // (template/urgency) is the most trustworthy rule.
  hits.sort(
    (a, b) =>
      CONDITION_RANK[a.condition.kind] - CONDITION_RANK[b.condition.kind] ||
      a.priority - b.priority
  );

  const entityState = new Map<string, "confirmed" | "suggested">();
  let templateName: string | undefined;
  let urgency: MatchResult["urgency"];
  const matchedMatcherIds: string[] = [];
  for (const m of hits) {
    matchedMatcherIds.push(m.id);
    const ms = m.action.matchState ?? defaultMatchState(m.condition.kind);
    for (const eid of m.action.entityIds ?? []) {
      // confirmed wins if any rule confirms this entity.
      if (ms === "confirmed" || entityState.get(eid) === "confirmed") {
        entityState.set(eid, "confirmed");
      } else if (!entityState.has(eid)) {
        entityState.set(eid, "suggested");
      }
    }
    if (templateName === undefined && m.action.templateName) templateName = m.action.templateName;
    if (urgency === undefined && m.action.urgency) urgency = m.action.urgency;
  }

  return {
    entities: [...entityState.entries()].map(([entityId, matchState]) => ({
      entityId,
      matchState,
    })),
    templateName,
    urgency,
    matchedMatcherIds,
  };
}

// Applies a match to a freshly-created meeting: writes the entity edges (with
// trust) and records the matched template + matcher ids in properties.match
// (the prep-template slice reads templateName; learn-by-confirmation reads the
// matcher ids). Runs on CREATE only (the calendar wiring), never on every
// update, so a suggestion the user rejected is not resurrected on a reschedule.
// urgency is intentionally not written to meetings (no UI surface, ADR-018);
// it rides the result for future task-producing matchers.
export async function applyMatchersToMeeting(
  ownerId: string,
  itemId: string,
  event: CalendarEvent,
  opts: { onError?: (entityId: string, err: unknown) => void } = {}
): Promise<{ edges: number; templateName?: string }> {
  const result = await matchEvent(ownerId, event);
  let edges = 0;
  for (const e of result.entities) {
    try {
      await addMatchEdge(ownerId, itemId, e.entityId, e.matchState);
      edges++;
    } catch (err) {
      // A rule pointing at a since-deleted entity shouldn't fail the others.
      opts.onError?.(e.entityId, err);
    }
  }

  if (result.templateName || result.matchedMatcherIds.length > 0) {
    const db = getDb();
    const cur = await db
      .select({ properties: items.properties })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
    const base =
      cur[0]?.properties && typeof cur[0].properties === "object" && !Array.isArray(cur[0].properties)
        ? (cur[0].properties as Record<string, unknown>)
        : {};
    await db
      .update(items)
      .set({
        properties: {
          ...base,
          match: {
            templateName: result.templateName ?? null,
            matcherIds: result.matchedMatcherIds,
          },
        },
      })
      .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
  }

  return { edges, templateName: result.templateName };
}
