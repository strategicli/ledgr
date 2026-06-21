// Calendar feed (ADR-094 E3): read the un-promoted upcoming events for the
// /events "From your calendar" section, and promote one to a real `event` item
// on a manual Add (or reuse the existing item if it was already promoted).
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, items } from "@/db/schema";
import { ItemError } from "@/lib/items";
import { applyMatchersToMeeting } from "@/lib/matchers/engine";
import type { CalendarEvent } from "./types";

export type FeedEvent = {
  id: string; // the cache row id (what Add posts)
  msEventId: string;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  isOnline: boolean;
  location: string | null;
  attendeeCount: number;
};

type CacheMeta = {
  organizer: CalendarEvent["organizer"];
  attendees: CalendarEvent["attendees"];
  location: string | null;
  isOnline: boolean;
  joinUrl: string | null;
  webLink: string | null;
  seriesMasterId: string | null;
  bodyPreview: string | null;
  lastModified: string | null;
};

// The upcoming, un-promoted, non-cancelled events — the calendar feed. Ordered
// by start, capped. Owner-scoped + index-backed (calendar_events_feed_idx).
export async function listCalendarFeed(
  ownerId: string,
  opts: { now?: Date; limit?: number } = {}
): Promise<FeedEvent[]> {
  const now = opts.now ?? new Date();
  const rows = await getDb()
    .select({
      id: calendarEvents.id,
      msEventId: calendarEvents.msEventId,
      title: calendarEvents.title,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      meta: calendarEvents.meta,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.ownerId, ownerId),
        isNull(calendarEvents.promotedItemId),
        eq(calendarEvents.isCancelled, false),
        gte(calendarEvents.startAt, now)
      )
    )
    .orderBy(asc(calendarEvents.startAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  return rows.map((r) => {
    const m = (r.meta ?? {}) as Partial<CacheMeta>;
    return {
      id: r.id,
      msEventId: r.msEventId,
      title: r.title,
      startAt: r.startAt,
      endAt: r.endAt,
      isOnline: m.isOnline ?? false,
      location: m.location ?? null,
      attendeeCount: m.attendees?.length ?? 0,
    };
  });
}

// Reconstruct a CalendarEvent from a cached row — enough for the matcher engine.
function toCalendarEvent(row: {
  msEventId: string;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  isCancelled: boolean;
  meta: unknown;
  lastModified: string | null;
}): CalendarEvent {
  const m = (row.meta ?? {}) as Partial<CacheMeta>;
  return {
    id: row.msEventId,
    title: row.title,
    startUtc: row.startAt ?? new Date(),
    endUtc: row.endAt,
    isCancelled: row.isCancelled,
    organizer: m.organizer ?? null,
    attendees: m.attendees ?? [],
    location: m.location ?? null,
    isOnline: m.isOnline ?? false,
    joinUrl: m.joinUrl ?? null,
    webLink: m.webLink ?? null,
    seriesMasterId: m.seriesMasterId ?? null,
    bodyPreview: m.bodyPreview ?? null,
    lastModified: row.lastModified,
  };
}

// Promote one cached event to a real `event` item (the manual "Add"). Idempotent:
// if already promoted, returns the existing item id. Runs the matchers so a
// manually-added event still gets its known people attached for prep.
export async function promoteCalendarEvent(
  ownerId: string,
  cacheId: string
): Promise<{ itemId: string; alreadyPromoted: boolean }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, cacheId), eq(calendarEvents.ownerId, ownerId)));
  const row = rows[0];
  if (!row) throw new ItemError("not_found", "calendar event not found");
  if (row.promotedItemId) {
    return { itemId: row.promotedItemId, alreadyPromoted: true };
  }

  const inserted = await db
    .insert(items)
    .values({
      ownerId,
      type: "event",
      title: row.title,
      meetingAt: row.startAt,
      msEventId: row.msEventId,
      status: "open",
      inbox: false,
      properties: row.meta ? { calendar: row.meta } : null,
    })
    .returning({ id: items.id });
  const itemId = inserted[0].id;
  await db
    .update(calendarEvents)
    .set({ promotedItemId: itemId })
    .where(and(eq(calendarEvents.id, cacheId), eq(calendarEvents.ownerId, ownerId)));

  // Attach matched people/template (a no-op when no matcher hits). Best-effort:
  // the event is added either way.
  try {
    await applyMatchersToMeeting(ownerId, itemId, toCalendarEvent(row));
  } catch {
    /* swallow — the add succeeded; matching is best-effort */
  }

  return { itemId, alreadyPromoted: false };
}
