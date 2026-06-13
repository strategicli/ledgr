// Matcher CRUD (slice 23). Owner-scoped; the setup wizard and
// learn-by-confirmation write rules through here, and the engine reads them.
// No seeded rules ship (PRD §5.1: matchers are user-built).
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { matchers } from "@/db/schema";
import { ItemError } from "@/lib/items";
import type { Matcher, MatcherCondition, MatcherInput } from "./types";

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

export function listMatchers(ownerId: string): Promise<Matcher[]> {
  return getDb()
    .select({
      id: matchers.id,
      priority: matchers.priority,
      condition: matchers.condition,
      action: matchers.action,
    })
    .from(matchers)
    .where(eq(matchers.ownerId, ownerId))
    .orderBy(asc(matchers.priority)) as Promise<Matcher[]>;
}

export async function createMatcher(ownerId: string, input: MatcherInput): Promise<Matcher> {
  const condition = validateCondition(input.condition);
  const action = input.action ?? {};
  if (action && typeof action !== "object") {
    throw new ItemError("bad_request", "action must be an object");
  }
  const rows = await getDb()
    .insert(matchers)
    .values({
      ownerId,
      priority: input.priority ?? 0,
      condition,
      action,
    })
    .returning({
      id: matchers.id,
      priority: matchers.priority,
      condition: matchers.condition,
      action: matchers.action,
    });
  return rows[0] as Matcher;
}

export async function deleteMatcher(ownerId: string, id: string): Promise<{ deleted: number }> {
  const rows = await getDb()
    .delete(matchers)
    .where(and(eq(matchers.id, id), eq(matchers.ownerId, ownerId)))
    .returning({ id: matchers.id });
  return { deleted: rows.length };
}
