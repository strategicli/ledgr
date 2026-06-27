// Event intake (EM2, ADR-123). The single entry point run when a calendar event
// becomes an `event` item (the manual Add today; create-only, never on re-sync,
// so a suggestion the owner rejected is not resurrected). Three tiers:
//   A — recognized: a pinned (autoApply) template's condition matches the event.
//       EM3 applies the template (confirmed people + content); EM2 records it.
//   B — unrecognized: the always-on suggester proposes people, written as
//       `suggested` edges so the existing ✓/✕ confirm-reject UX surfaces them.
//   C — nothing determinable: no edges; the UI shows an empty-state.
// Provenance (the chosen template / the suggestions + why) is recorded in
// items.properties.match for display + debugging.
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { addMatchEdge } from "@/lib/relations";
import { matchEventToTemplate } from "./event-rules";
import { suggestPeopleForEvent, type PersonSuggestion } from "./suggest-people";
import type { CalendarEvent } from "./types";

export type EventMatchRecord = {
  // Tier A: the template a rule chose.
  templateId?: string;
  templateName?: string;
  // Why it matched (the condition kind), for provenance/debugging.
  condition?: string;
  // Tier B: the suggested people + the signal that surfaced each.
  suggestions?: {
    personId: string;
    reason: PersonSuggestion["reason"];
    confidence: PersonSuggestion["confidence"];
  }[];
};

export type IntakeResult =
  | { tier: "recognized"; templateId: string }
  | { tier: "suggested"; count: number }
  | { tier: "none" };

// Merge the match record into items.properties.match without clobbering other
// keys (calendar metadata, taskPull, …) — the applyMatchersToMeeting pattern.
async function recordEventMatch(
  ownerId: string,
  itemId: string,
  match: EventMatchRecord
): Promise<void> {
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
    .set({ properties: { ...base, match } })
    .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
}

export async function applyEventIntake(
  ownerId: string,
  itemId: string,
  event: CalendarEvent,
  opts: { onError?: (personId: string, err: unknown) => void } = {}
): Promise<IntakeResult> {
  // Tier A — recognized (a pinned template's condition matches).
  const match = await matchEventToTemplate(ownerId, event);
  if (match && match.rule.autoApply) {
    // EM3 wires applyTemplateToExisting here (confirmed people + content); EM2
    // records the match so the gap is just "not yet applied", not "lost".
    await recordEventMatch(ownerId, itemId, {
      templateId: match.rule.templateId,
      templateName: match.rule.templateName,
      condition: match.rule.condition.kind,
    });
    return { tier: "recognized", templateId: match.rule.templateId };
  }

  // Tier B — suggestions, written as `suggested` edges (best-effort: a vanished
  // person never fails the others, and the add succeeds regardless).
  const suggestions = await suggestPeopleForEvent(ownerId, event, { limit: 3 });
  const written: typeof suggestions = [];
  for (const s of suggestions) {
    try {
      await addMatchEdge(ownerId, itemId, s.personId, "suggested");
      written.push(s);
    } catch (err) {
      opts.onError?.(s.personId, err);
    }
  }
  if (written.length > 0) {
    await recordEventMatch(ownerId, itemId, {
      suggestions: written.map((s) => ({
        personId: s.personId,
        reason: s.reason,
        confidence: s.confidence,
      })),
    });
    return { tier: "suggested", count: written.length };
  }

  // Tier C — nothing determinable.
  return { tier: "none" };
}
