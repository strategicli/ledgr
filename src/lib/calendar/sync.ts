// Calendar sync engine (slice 22 / ADR-094 E3, PRD §5.1, ADR-023). Deterministic
// plumbing, no model in the loop: poll the next N days and reconcile each event
// against the calendar_events cache. The sync no longer auto-creates an item per
// event (the ADR-023 firehose); it upserts every event into the cache,
// AUTO-PROMOTES the ones a matcher recognizes (a standing 1:1, a series) into
// real `event` items, and leaves the rest in the cache as one-click "Add"s in
// the /events calendar feed. A promoted event keeps reschedule/cancel handling
// on its item; cancel flags it (prep survives) and never deletes.
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, items, jobState } from "@/db/schema";
import type { CalendarEvent, CalendarSource } from "./types";

export const CALENDAR_JOB_KEY = "calendar_sync";
export const DEFAULT_WINDOW_DAYS = 14;

export type CalendarRunResult = {
  seen: number;
  // Matched events newly auto-promoted to `event` items this run.
  promoted: number;
  // Newly cached events left in the feed (un-promoted, waiting for a manual Add).
  cached: number;
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

// What we persist under calendar_events.meta (and, for a promoted item, mirrored
// into items.properties.calendar). Attendees stay structured (matchers key on
// emails); for a promoted item attendeeEmails + names also fall into the FTS
// document. canceled rides here too.
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

// Merges calendar metadata into a promoted item's properties without clobbering
// keys a matcher wrote (matched template, default urgency, …).
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
    // Decide auto-promote: does any matcher recognize this event (a standing
    // 1:1, a series)? The route wires this to the matcher engine (matchEvent →
    // matchedMatcherIds non-empty). Kept a callback so the sync engine stays
    // matcher-agnostic and verifies on its own. Absent => nothing auto-promotes
    // (every new event waits in the feed).
    shouldPromote?: (event: CalendarEvent) => Promise<boolean>;
    // Invoked once per newly auto-promoted item, to attach the matched entities
    // / template; the route wires it to applyMatchersToMeeting. It catches its
    // own errors, so a matcher failure never fails the sync.
    onPromoted?: (itemId: string, event: CalendarEvent) => Promise<void>;
  } = {}
): Promise<CalendarRunResult> {
  const db = getDb();
  const windowDays = Math.min(Math.max(opts.windowDays ?? DEFAULT_WINDOW_DAYS, 1), 60);
  const events = await source.listEvents(windowDays);

  const result: CalendarRunResult = {
    seen: events.length,
    promoted: 0,
    cached: 0,
    updated: 0,
    canceled: 0,
    unchanged: 0,
    errors: 0,
  };

  // One lookup for every event's existing item (incl. trashed, so a deleted
  // event is never resurrected or duplicated). Owner-scoped.
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

  const syncStart = new Date();
  const syncedAt = syncStart.toISOString();
  for (const e of events) {
    try {
      const meta = buildMeta(e, syncedAt);
      const existing = byEventId.get(e.id);

      // 1. Cache the event snapshot, keyed by ms_event_id. On conflict we update
      // the snapshot but never the promotion link (set explicitly below), so an
      // existing promotion survives a re-sync.
      await db
        .insert(calendarEvents)
        .values({
          ownerId,
          msEventId: e.id,
          title: e.title,
          startAt: e.startUtc,
          endAt: e.endUtc,
          meta,
          isCancelled: e.isCancelled,
          lastModified: e.lastModified,
          syncedAt: syncStart,
          promotedItemId: existing?.id ?? null,
        })
        .onConflictDoUpdate({
          target: [calendarEvents.ownerId, calendarEvents.msEventId],
          set: {
            title: e.title,
            startAt: e.startUtc,
            endAt: e.endUtc,
            meta,
            isCancelled: e.isCancelled,
            lastModified: e.lastModified,
            syncedAt: syncStart,
          },
        });

      // 2. Already promoted (an item exists for this event, live or trashed):
      // point the cache at it (so it stays out of the feed) and reconcile.
      if (existing) {
        await db
          .update(calendarEvents)
          .set({ promotedItemId: existing.id })
          .where(
            and(
              eq(calendarEvents.ownerId, ownerId),
              eq(calendarEvents.msEventId, e.id)
            )
          );
        // Respect a user delete: never write to (or resurrect) a trashed item.
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
        if (e.isCancelled && !wasCanceled) result.canceled++;
        else result.updated++;
        continue;
      }

      // 3. No item yet. Auto-promote when a matcher recognizes the event (and it
      // isn't a cancellation); otherwise it waits in the feed as a one-click Add.
      let promote = false;
      if (!e.isCancelled && opts.shouldPromote) {
        promote = await opts.shouldPromote(e);
      }
      if (promote) {
        const inserted = await db
          .insert(items)
          .values({
            ownerId,
            type: "event",
            title: e.title,
            meetingAt: e.startUtc,
            msEventId: e.id,
            status: "open",
            // Auto-promoted events arrive fully-formed; they belong in
            // Events/Today, not the triage queue (ADR-023).
            inbox: false,
            properties: { calendar: meta },
          })
          .returning({ id: items.id });
        await db
          .update(calendarEvents)
          .set({ promotedItemId: inserted[0].id })
          .where(
            and(
              eq(calendarEvents.ownerId, ownerId),
              eq(calendarEvents.msEventId, e.id)
            )
          );
        result.promoted++;
        if (opts.onPromoted) await opts.onPromoted(inserted[0].id, e);
      } else {
        result.cached++;
      }
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
