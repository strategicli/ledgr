// Template match rule (EM1, ADR-123). A template may carry an optional
// `match_config` = a calendar-match CONDITION + an autoApply flag. The condition
// vocabulary is the matcher engine's (attendeeEmail / seriesId / titleRegex /
// titleFuzzy), reused verbatim so there is one definition of "how a condition
// matches an event"; only the rule SOURCE moves (the matchers table → templates).
//
// This supersedes the slice-23 matchers store as the rule source. The validator
// is STRICT (throws) — a silently-dropped match rule would be a confusing
// data-loss footgun, unlike the tolerant date-rule parser on applyConfig.
import { ItemError } from "@/lib/items";
import { validateCondition } from "@/lib/matchers/store";
import type { MatcherCondition } from "@/lib/matchers/types";

export type TemplateMatchConfig = {
  // Which calendar events this template governs.
  condition: MatcherCondition;
  // Pinned/locked: when true and the condition matches, a matching event applies
  // this template on Add (Tier A). When false, the rule is dormant — the
  // template exists but doesn't auto-apply (lets the owner pause without
  // deleting). Suggestions still come from the always-on suggester (EM2).
  autoApply: boolean;
};

// Strict parse: rejects a malformed condition (reusing the matcher validator, so
// a bad regex/email fails at save time, never mid-match) and coerces autoApply.
export function validateMatchConfig(raw: unknown): TemplateMatchConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ItemError("bad_request", "matchConfig must be an object");
  }
  const r = raw as Record<string, unknown>;
  const condition = validateCondition(r.condition);
  if (r.autoApply !== undefined && typeof r.autoApply !== "boolean") {
    throw new ItemError("bad_request", "matchConfig.autoApply must be a boolean");
  }
  return { condition, autoApply: r.autoApply === true };
}

// Tolerant read for a stored row: a legacy/garbled blob reads as "no rule"
// rather than throwing on every list. Save-time validation is the strict gate.
export function parseMatchConfig(raw: unknown): TemplateMatchConfig | null {
  if (raw == null) return null;
  try {
    return validateMatchConfig(raw);
  } catch {
    return null;
  }
}
