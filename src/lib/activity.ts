// The activity log (Project Type, ADR-111): emit + read helpers over
// activity_events. Recent Activity, the Digest, and the Overview Story weave are
// all downstream of this table, so we invest in a rich, pre-rendered log now
// (PRD §4). Emission lives in the server write paths (items.ts create/update,
// relations.ts containment) so every caller — canvas, MCP, REST, cron — is
// covered, the same discipline updateItem uses for recurrence.
//
// Subject vs actor: the SUBJECT is the container record the event narrates
// (usually a project); the ACTOR is the thing that triggered it (a completed
// task, an added note) when distinct. Events are only logged when their subject
// is a TRACKED record — keeping the log a project narrative, not a global
// firehose (an inbox task with no home parent logs nothing).
//
// This module imports no app code (only getDb + schema + drizzle) so it can be
// imported by both items.ts and relations.ts without a cycle.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityEvents, items, relations } from "@/db/schema";

export type ActivityKind = (typeof activityEvents.kind.enumValues)[number];

// Types whose records carry an activity log / Digest. For now just `project`;
// `pursuit` joins here when it lands (PJ9), and any type the user gives the
// Digest behavior. Kept as one predicate so the rule has a single home.
const TRACKED_SUBJECT_TYPES = new Set<string>(["project"]);

export function isTrackedSubjectType(type: string): boolean {
  return TRACKED_SUBJECT_TYPES.has(type);
}

type EmitArgs = {
  ownerId: string;
  subjectId: string;
  kind: ActivityKind;
  summary: string;
  actorId?: string | null;
  payload?: Record<string, unknown> | null;
};

// Append one event. Best-effort by contract of its callers: emission must never
// break the user's actual write, so callers wrap it in a catch where a failed
// log line is not worth aborting a save (the log is derived narrative, not the
// source of truth).
export async function emitActivity(args: EmitArgs) {
  const rows = await getDb()
    .insert(activityEvents)
    .values({
      ownerId: args.ownerId,
      subjectId: args.subjectId,
      actorId: args.actorId ?? null,
      kind: args.kind,
      summary: args.summary,
      payload: args.payload ?? null,
    })
    .returning();
  return rows[0];
}

// The single home (primary residence) parent of a child item, or null. Used to
// resolve the SUBJECT for actor-level events (a completed task narrates its
// project). Owner-scoped, live, non-template; one row by the partial unique
// index on home edges.
export async function homeParentOf(
  ownerId: string,
  childId: string
): Promise<{ id: string; type: string } | null> {
  const rows = await getDb()
    .select({ id: items.id, type: items.type })
    .from(relations)
    .innerJoin(items, eq(items.id, relations.targetId))
    .where(
      and(
        eq(relations.sourceId, childId),
        eq(relations.home, true),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

// A record's timeline, newest first — the Recent Activity widget, the Digest,
// and the Story weave all read from here. Owner-scoped; the subject index serves
// it directly.
export async function listActivity(
  ownerId: string,
  subjectId: string,
  limit = 50
) {
  return getDb()
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.ownerId, ownerId),
        eq(activityEvents.subjectId, subjectId)
      )
    )
    .orderBy(desc(activityEvents.occurredAt))
    .limit(limit);
}

// The staleness clock, DERIVED (no column): the latest checkin_reviewed for a
// record. Responding to a Digest writes a checkin_reviewed event, which advances
// this automatically (PRD §7). Null = never reviewed.
export async function lastReviewedAt(
  ownerId: string,
  subjectId: string
): Promise<Date | null> {
  const rows = await getDb()
    .select({ max: sql<string | null>`max(${activityEvents.occurredAt})` })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.ownerId, ownerId),
        eq(activityEvents.subjectId, subjectId),
        eq(activityEvents.kind, "checkin_reviewed")
      )
    );
  // A raw sql<> aggregate comes back as a string from the driver (no timestamp
  // mode coercion), so normalize to a Date.
  const max = rows[0]?.max;
  return max ? new Date(max) : null;
}

// When the Overview Story was last woven (PJ8): the latest overview_woven event.
// Derived (no column), like last_reviewed_at. null = never woven.
export async function lastWovenAt(
  ownerId: string,
  subjectId: string
): Promise<Date | null> {
  const rows = await getDb()
    .select({ max: sql<string | null>`max(${activityEvents.occurredAt})` })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.ownerId, ownerId),
        eq(activityEvents.subjectId, subjectId),
        eq(activityEvents.kind, "overview_woven")
      )
    );
  const max = rows[0]?.max;
  return max ? new Date(max) : null;
}

// The most recent activity of ANY kind on a record (the staleness numerator for
// the Digest, PJ7). Derived; null = no activity ever.
export async function lastActivityAt(
  ownerId: string,
  subjectId: string
): Promise<Date | null> {
  const rows = await getDb()
    .select({ max: sql<string | null>`max(${activityEvents.occurredAt})` })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.ownerId, ownerId),
        eq(activityEvents.subjectId, subjectId)
      )
    );
  const max = rows[0]?.max;
  return max ? new Date(max) : null;
}

// Record that the user reviewed a record's Digest/check-in: writes a
// checkin_reviewed event, which resets the derived staleness clock (PRD §7 the
// review-resets-clock loop). The Digest cron (PJ7) calls this on response; kept
// here so last_reviewed_at derivation is exercised from PJ1. Owner-scoped.
export async function reviewCheckin(ownerId: string, recordId: string) {
  const owned = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.id, recordId),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt)
      )
    );
  if (owned.length === 0) return null;
  return emitActivity({
    ownerId,
    subjectId: recordId,
    kind: "checkin_reviewed",
    summary: "Reviewed",
  });
}
