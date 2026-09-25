// Matcher CRUD (slice 23; DORMANT since EM3, ADR-123; part of the calendar-sync
// module, ADR-272 step 4). Owner-scoped; the setup wizard and
// learn-by-confirmation write rules through here, and the engine reads them.
// No seeded rules ship (PRD §5.1: matchers are user-built).
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { matchers } from "@/db/schema";
import { ItemError } from "@/lib/items";
import type { Matcher, MatcherInput } from "@/lib/matchers/types";
import { validateCondition } from "@/lib/templates/match-config";

// validateCondition moved to core (src/lib/templates/match-config.ts): the
// template match rules, which are core, are its live caller.

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
