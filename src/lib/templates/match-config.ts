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
import type { MatcherCondition } from "@/lib/matchers/types";

const KINDS = ["attendeeEmail", "seriesId", "titleRegex", "titleFuzzy"] as const;

// Hand-rolled validation (the api.ts pattern; small shapes don't earn a lib).
// Bad rules must never reach the engine, where a malformed regex or condition
// would throw mid-sync.
export function validateCondition(raw: unknown): MatcherCondition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ItemError("bad_request", "condition must be an object");
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.kind !== "string" || !KINDS.includes(c.kind as never)) {
    throw new ItemError("bad_request", `condition.kind must be one of ${KINDS.join(", ")}`);
  }
  switch (c.kind) {
    case "attendeeEmail":
      if (typeof c.email !== "string" || !c.email.includes("@")) {
        throw new ItemError("bad_request", "attendeeEmail condition needs an email");
      }
      return { kind: "attendeeEmail", email: c.email.toLowerCase() };
    case "seriesId":
      if (typeof c.seriesMasterId !== "string" || !c.seriesMasterId) {
        throw new ItemError("bad_request", "seriesId condition needs seriesMasterId");
      }
      return { kind: "seriesId", seriesMasterId: c.seriesMasterId };
    case "titleRegex": {
      if (typeof c.pattern !== "string" || !c.pattern || c.pattern.length > 200) {
        throw new ItemError("bad_request", "titleRegex needs a pattern (<=200 chars)");
      }
      const flags = typeof c.flags === "string" ? c.flags : undefined;
      // Compile now so a bad pattern fails at save time, not mid-sync.
      try {
        new RegExp(c.pattern, flags);
      } catch {
        throw new ItemError("bad_request", "titleRegex pattern is not a valid regex");
      }
      return { kind: "titleRegex", pattern: c.pattern, ...(flags ? { flags } : {}) };
    }
    case "titleFuzzy": {
      if (typeof c.pattern !== "string" || !c.pattern || c.pattern.length > 200) {
        throw new ItemError("bad_request", "titleFuzzy needs a pattern (<=200 chars)");
      }
      const threshold = c.threshold === undefined ? undefined : Number(c.threshold);
      if (threshold !== undefined && (Number.isNaN(threshold) || threshold < 0 || threshold > 1)) {
        throw new ItemError("bad_request", "titleFuzzy threshold must be 0..1");
      }
      return { kind: "titleFuzzy", pattern: c.pattern, ...(threshold !== undefined ? { threshold } : {}) };
    }
    default:
      throw new ItemError("bad_request", "unknown condition kind");
  }
}

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
