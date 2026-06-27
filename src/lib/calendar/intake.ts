// Event intake (ADR-123). Run when a calendar event becomes an `event` item
// (the manual Add today; create-only, never on re-sync). Two outcomes:
//   A — recognized: a pinned (autoApply) template's condition matches → apply it,
//       so its pre-related people land as CONFIRMED edges (they flow straight
//       into prep/task-pull) and its recurring content copies on.
//   none — no pinned template matches: nothing is written here. PERSON
//       SUGGESTIONS ARE COMPUTED LIVE ON THE EVENT CANVAS (getMeetingPrep), not
//       pre-written as edges, so they show for ANY event (added, imported, or
//       hand-made), and the canvas offers a one-click add. (This replaced the
//       earlier "write suggested edges at intake" approach, which only surfaced
//       on feed-Added events.)
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { applyTemplateToExisting } from "@/lib/templates";
import { matchEventToTemplate } from "./event-rules";
import type { CalendarEvent } from "./types";

export type EventMatchRecord = {
  templateId?: string;
  templateName?: string;
  // Why it matched (the condition kind), for provenance/debugging.
  condition?: string;
};

export type IntakeResult =
  | { tier: "recognized"; templateId: string }
  | { tier: "none" };

// Merge the match record into items.properties.match without clobbering other
// keys (calendar metadata, taskPull, …).
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
  opts: { onError?: (templateId: string, err: unknown) => void } = {}
): Promise<IntakeResult> {
  // Tier A — recognized (a pinned template's condition matches): apply it. "fill"
  // never clobbers what the event already has (title, calendar metadata). A
  // since-deleted/mismatched template must not fail the add — record either way.
  const match = await matchEventToTemplate(ownerId, event);
  if (match && match.rule.autoApply) {
    try {
      await applyTemplateToExisting(ownerId, match.rule.templateId, itemId, { mode: "fill" });
    } catch (err) {
      opts.onError?.(match.rule.templateId, err);
    }
    await recordEventMatch(ownerId, itemId, {
      templateId: match.rule.templateId,
      templateName: match.rule.templateName,
      condition: match.rule.condition.kind,
    });
    return { tier: "recognized", templateId: match.rule.templateId };
  }

  // Otherwise nothing is written — suggestions are live on the canvas.
  return { tier: "none" };
}
