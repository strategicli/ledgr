// Calendar sync engine (slice 22, PRD §5.1, ADR-023). Deterministic plumbing,
// no model in the loop: poll the next N days, reconcile each event to a
// `meeting` item keyed by ms_event_id. Reschedule updates meeting_at; cancel
// flags the item (prep survives) and never deletes. Entity/template matching
// is the next slice (23); this slice stores attendees + metadata in
// properties.calendar so those matchers have structured data to read.
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { items, jobState } from "@/db/schema";
import type { CalendarEvent, CalendarSource } from "./types";

export const CALENDAR_JOB_KEY = "calendar_sync";
export const DEFAULT_WINDOW_DAYS = 14;

export type CalendarRunResult = {
  seen: number;
  created: number;
  updated: number;
  canceled: number;
  unchanged: number;
  errors: number;
};

export type CalendarJobState = {
  lastRunAt: string;
  // The /health canary: set only by a run with zero errors.
  lastSuccessAt: string | null;
  lastResult: CalendarRunResult;
  windowDays: number;
};

// What we persist under items.properties.calendar. Attendees stay structured
// (matchers key on emails); attendeeEmails + names also fall into the FTS
// document (jsonb_to_tsvector indexes string values), so "Roger" finds his
// meetings. canceled is here, not a column: it isn't a hot filter in v1, and
// keeping it off the schema avoids a migration (hot-fields-are-columns, ADR-003).
type CalendarMeta = {
  organizer: CalendarEvent["organizer"];
  attendees: CalendarEvent["attendees"];
  attendeeEmails: string[];
  location: string | null;
  isOnline: boolean;
  joinUrl: string | null;
  webLink: string | null;
  seriesMasterId: string | null;
  bodyPreview: string | null;
  canceled: boolean;
  lastModified: string | null;
  syncedAt: string;
};

function buildMeta(e: CalendarEvent, syncedAt: string): CalendarMeta {
  return {
    organizer: e.organizer,
    attendees: e.attendees,
    attendeeEmails: e.attendees
      .map((a) => a.email)
      .filter((x): x is string => !!x),
    location: e.location,
    isOnline: e.isOnline,
    joinUrl: e.joinUrl,
    webLink: e.webLink,
    seriesMasterId: e.seriesMasterId,
    bodyPreview: e.bodyPreview,
    canceled: e.isCancelled,
    lastModified: e.lastModified,
    syncedAt,
  };
}

type ExistingRow = {
  id: string;
  title: string;
  meetingAt: Date | null;
  properties: unknown;
  deletedAt: Date | null;
};

// True when nothing the engine maps has changed since the last sync, so the
// write (and the consequent updated_at bump that would re-export the item) can
// be skipped. lastModified catches attendee/location/body edits without
// diffing every field.
function unchangedSince(e: CalendarEvent, row: ExistingRow): boolean {
  const props = (row.properties ?? {}) as { calendar?: Partial<CalendarMeta> };
  const cal = props.calendar ?? {};
  const sameTime =
    (row.meetingAt?.getTime() ?? null) === e.startUtc.getTime();
  return (
    row.title === e.title &&
    sameTime &&
    (cal.canceled ?? false) === e.isCancelled &&
    (cal.lastModified ?? null) === e.lastModified
  );
}

// Merges calendar metadata into properties without clobbering keys a future
// matcher (slice 23) may have written (matched template, default urgency, …).
function mergeProps(existing: unknown, meta: CalendarMeta): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, calendar: meta };
}

export async function runCalendarSync(
  ownerId: string,
  source: CalendarSource,
  opts: {
    windowDays?: number;
    onError?: (eventId: string, err: unknown) => void;
    // Invoked once per newly-created meeting (CREATE only, never on update, so
    // a rejected suggestion isn't resurrected on a reschedule). The calendar
    // routes wire this to the matcher engine (slice 23); it catches its own
    // errors, so a matcher failure never fails the sync. Kept as a callback so
    // the sync engine stays matcher-agnostic and verifies independently.
    onCreated?: (itemId: string, event: CalendarEvent) => Promise<void>;
  } = {}
): Promise<CalendarRunResult> {
  const db = getDb();
  const windowDays = Math.min(Math.max(opts.windowDays ?? DEFAULT_WINDOW_DAYS, 1), 60);
  const events = await source.listEvents(windowDays);

  const result: CalendarRunResult = {
    seen: events.length,
    created: 0,
    updated: 0,
    canceled: 0,
    unchanged: 0,
    errors: 0,
  };

  // One lookup for every event's existing item (incl. trashed, so a deleted
  // meeting is never resurrected as a duplicate). Owner-scoped.
  const ids = [...new Set(events.map((e) => e.id))];
  const existingRows = ids.length
    ? await db
        .select({
          id: items.id,
          title: items.title,
          meetingAt: items.meetingAt,
          properties: items.properties,
          deletedAt: items.deletedAt,
          msEventId: items.msEventId,
        })
        .from(items)
        .where(and(eq(items.ownerId, ownerId), inArray(items.msEventId, ids)))
    : [];
  const byEventId = new Map<string, ExistingRow>();
  for (const r of existingRows) {
    if (r.msEventId) byEventId.set(r.msEventId, r);
  }

  const syncedAt = new Date().toISOString();
  for (const e of events) {
    try {
      const existing = byEventId.get(e.id);
      const meta = buildMeta(e, syncedAt);

      if (!existing) {
        // A meeting cancelled before we ever synced it has no prep to protect;
        // don't create a tombstone.
        if (e.isCancelled) {
          result.unchanged++;
          continue;
        }
        const inserted = await db
          .insert(items)
          .values({
            ownerId,
            type: "meeting",
            title: e.title,
            meetingAt: e.startUtc,
            msEventId: e.id,
            status: "open",
            // Calendar events arrive fully-formed (type + time); they belong in
            // Meetings/Today, not the triage queue (ADR-023). Entity links are
            // matchers' job, not inbox triage.
            inbox: false,
            properties: { calendar: meta },
          })
          .returning({ id: items.id });
        result.created++;
        if (opts.onCreated) await opts.onCreated(inserted[0].id, e);
        continue;
      }

      // Respect a user delete: never write to (or resurrect) a trashed item;
      // the map already prevents a duplicate.
      if (existing.deletedAt) {
        result.unchanged++;
        continue;
      }
      if (unchangedSince(e, existing)) {
        result.unchanged++;
        continue;
      }

      const wasCanceled =
        ((existing.properties ?? {}) as { calendar?: { canceled?: boolean } })
          .calendar?.canceled === true;
      await db
        .update(items)
        .set({
          title: e.title,
          meetingAt: e.startUtc,
          properties: mergeProps(existing.properties, meta),
        })
        .where(and(eq(items.id, existing.id), eq(items.ownerId, ownerId)));
      // A fresh cancellation is the headline outcome; otherwise it's a
      // reschedule/detail update.
      if (e.isCancelled && !wasCanceled) result.canceled++;
      else result.updated++;
    } catch (err) {
      result.errors++;
      opts.onError?.(e.id, err);
    }
  }

  const now = new Date().toISOString();
  const prior = await db
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, CALENDAR_JOB_KEY));
  const priorState = (prior[0]?.value ?? null) as CalendarJobState | null;
  const state: CalendarJobState = {
    lastRunAt: now,
    lastSuccessAt: result.errors === 0 ? now : (priorState?.lastSuccessAt ?? null),
    lastResult: result,
    windowDays,
  };
  await db
    .insert(jobState)
    .values({ key: CALENDAR_JOB_KEY, value: state })
    .onConflictDoUpdate({ target: jobState.key, set: { value: state } });

  return result;
}

export async function getCalendarState(): Promise<CalendarJobState | null> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, CALENDAR_JOB_KEY));
  return (rows[0]?.value as CalendarJobState) ?? null;
}
