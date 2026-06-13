// Matcher types (slice 23, PRD §5.1). An ordered, user-built rule maps a
// calendar event to entities/templates. Conditions are checked in a fixed
// kind precedence (attendee-email is the most reliable signal, fuzzy title the
// last resort); within a kind, the user-set priority orders them.
import type { Urgency } from "@/lib/item-enums";

export type MatcherCondition =
  // The most reliable signal: a specific attendee (or organizer) email.
  | { kind: "attendeeEmail"; email: string }
  // A specific recurring series (every instance of that series).
  | { kind: "seriesId"; seriesMasterId: string }
  // A user-authored regex over the event title.
  | { kind: "titleRegex"; pattern: string; flags?: string }
  // Last resort (pg_trgm similarity), only when no attendee/series/regex rule
  // matched — for external guests / room-only invites with no structured
  // signal. threshold defaults to 0.3 (Postgres' pg_trgm default).
  | { kind: "titleFuzzy"; pattern: string; threshold?: number };

export type MatcherAction = {
  // Entity items to attach as relations (the "tag with default entities").
  entityIds?: string[];
  // Named meeting-prep template to apply (slice 24 consumes this; this slice
  // records it in properties.calendar.matchedTemplate).
  templateName?: string;
  // Default urgency to set on the meeting (no UI effect on meetings today,
  // ADR-018; carried for completeness and future task-producing matchers).
  urgency?: Urgency;
  // Override the per-kind default match_state if a rule wants to.
  matchState?: "confirmed" | "suggested";
};

export type Matcher = {
  id: string;
  priority: number;
  condition: MatcherCondition;
  action: MatcherAction;
};

export type MatcherInput = {
  priority?: number;
  condition: MatcherCondition;
  action: MatcherAction;
};

// Fixed kind precedence (PRD §5.1): attendee-email -> series-id -> title-regex
// -> fuzzy. Lower rank wins; fuzzy is gated to "no higher-rank rule matched".
export const CONDITION_RANK: Record<MatcherCondition["kind"], number> = {
  attendeeEmail: 0,
  seriesId: 1,
  titleRegex: 2,
  titleFuzzy: 3,
};

// Default trust per kind (PRD §3.3: attendee-email and fuzzy land 'suggested').
// series-id and regex are exact/user-authored, so they confirm. A rule's
// action.matchState overrides this.
export function defaultMatchState(
  kind: MatcherCondition["kind"]
): "confirmed" | "suggested" {
  return kind === "seriesId" || kind === "titleRegex" ? "confirmed" : "suggested";
}

// What matchEvent returns: entities to attach (with trust), the chosen
// template, and a default urgency. The caller (calendar wiring) writes the
// edges and records the template.
export type MatchResult = {
  entities: { entityId: string; matchState: "confirmed" | "suggested" }[];
  templateName?: string;
  urgency?: Urgency;
  // The matcher ids that fired, for logging / learn-by-confirmation.
  matchedMatcherIds: string[];
};
