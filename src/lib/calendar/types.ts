// Calendar sync types + source interface (slice 22, PRD §5.1). The engine
// reads events through a CalendarSource, never from Graph directly — the same
// provider-interface discipline as ExportTarget (CLAUDE.md). The Graph source
// is production; a stub source verifies the engine against Neon with no creds
// and is the Phase 4 local-build seam.
//
// Core, not the calendar-sync module (ADR-272 step 4): the event canvas, the
// person suggester, template match rules and the calendar-cache readers all
// speak this shape. The module (src/modules/calendar-sync) fills the cache.

// How far ahead each sync pulls events into the cache. 4 weeks so the Planner's
// read-only calendar overlay (ADR-133) has a useful long-range planning horizon.
// The meeting-import feed (listCalendarFeed) bounds itself to 2 weeks separately,
// so widening this doesn't lengthen that suggestion list. Lives here, in core,
// because the feed reader clamps to it.
export const DEFAULT_WINDOW_DAYS = 28;

// A calendar event normalized to what Ledgr stores. The Graph source maps
// Microsoft's shape onto this; the engine never sees Graph JSON. attendees
// (emails) are the structured signal the matchers slice (23) keys on, so they
// are first-class here, not buried in a body.
export type CalendarPerson = {
  name: string | null;
  email: string | null;
};

export type CalendarEvent = {
  // Graph event id: the dedupe key stored as items.ms_event_id. Per-occurrence
  // for expanded recurring instances, so each 1:1 instance is its own meeting.
  id: string;
  title: string;
  // Real instants (UTC). The Graph source requests UTC so no zone math is
  // needed here; the canvas strip already round-trips meeting_at local<->UTC.
  startUtc: Date;
  endUtc: Date | null;
  // Cancelled events flag their item (prep survives) and are never deleted.
  isCancelled: boolean;
  organizer: CalendarPerson | null;
  attendees: CalendarPerson[];
  location: string | null;
  isOnline: boolean;
  joinUrl: string | null;
  webLink: string | null;
  // Set on expanded occurrences/exceptions; matchers can group a series.
  seriesMasterId: string | null;
  // Plain-text preview of the event description (full HTML->BlockNote body
  // conversion is an email-in concern; meeting bodies are the prep template's,
  // slice 24). Stored in properties, so it joins FTS as searchable text.
  bodyPreview: string | null;
  // Graph's lastModifiedDateTime; lets the engine skip unchanged events.
  lastModified: string | null;
};

export interface CalendarSource {
  // Returns every event in [now, now + windowDays], recurring series expanded
  // into individual occurrences. The engine owns dedupe/reconcile; the source
  // only fetches and normalizes.
  listEvents(windowDays: number): Promise<CalendarEvent[]>;
}
