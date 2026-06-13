// Graph calendar source (slice 22). Reads Brandon's calendar app-only over the
// shared Graph client (slice 21). Uses calendarView, not /events, so recurring
// series come back expanded into individual occurrences (you prep each 1:1
// instance separately, PRD §5.1). UTC is requested via Prefer so no zone math
// is needed downstream; the body is requested as text for a clean preview.
import { graphFetch, getGraphMailboxUpn, GraphError } from "@/lib/graph/client";
import type { CalendarEvent, CalendarPerson, CalendarSource } from "./types";

type GraphAddress = { name?: string; address?: string } | undefined;
type GraphAttendee = { type?: string; emailAddress?: GraphAddress };
type GraphDateTime = { dateTime?: string; timeZone?: string } | undefined;

type GraphEvent = {
  id: string;
  subject?: string;
  isCancelled?: boolean;
  start?: GraphDateTime;
  end?: GraphDateTime;
  organizer?: { emailAddress?: GraphAddress };
  attendees?: GraphAttendee[];
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  webLink?: string;
  seriesMasterId?: string;
  bodyPreview?: string;
  lastModifiedDateTime?: string;
};

const SELECT = [
  "id",
  "subject",
  "isCancelled",
  "start",
  "end",
  "organizer",
  "attendees",
  "location",
  "isOnlineMeeting",
  "onlineMeeting",
  "onlineMeetingUrl",
  "webLink",
  "seriesMasterId",
  "bodyPreview",
  "lastModifiedDateTime",
].join(",");

const PAGE_SIZE = 100;
// Bound the page walk: 14 days of even a packed calendar is far under this.
const MAX_PAGES = 25;

function person(addr: GraphAddress): CalendarPerson | null {
  if (!addr) return null;
  const name = addr.name?.trim() || null;
  const email = addr.address?.trim().toLowerCase() || null;
  if (!name && !email) return null;
  return { name, email };
}

// Graph returns dateTime like "2026-06-20T15:00:00.0000000" with timeZone
// "UTC" (because we asked); append Z so Date parses it as the UTC instant.
function utcInstant(dt: GraphDateTime): Date | null {
  if (!dt?.dateTime) return null;
  const raw = dt.dateTime;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalize(e: GraphEvent): CalendarEvent | null {
  const startUtc = utcInstant(e.start);
  // An event with no parseable start can't become a meeting_at; skip it
  // rather than write a null-time meeting (the caller counts it).
  if (!startUtc) return null;
  const attendees = (e.attendees ?? [])
    .map((a) => person(a.emailAddress))
    .filter((p): p is CalendarPerson => p !== null);
  return {
    id: e.id,
    title: e.subject?.trim() || "(no subject)",
    startUtc,
    endUtc: utcInstant(e.end),
    isCancelled: e.isCancelled === true,
    organizer: person(e.organizer?.emailAddress),
    attendees,
    location: e.location?.displayName?.trim() || null,
    isOnline: e.isOnlineMeeting === true,
    joinUrl: e.onlineMeeting?.joinUrl || e.onlineMeetingUrl || null,
    webLink: e.webLink || null,
    seriesMasterId: e.seriesMasterId || null,
    bodyPreview: e.bodyPreview?.trim() || null,
    lastModified: e.lastModifiedDateTime || null,
  };
}

export class GraphCalendarSource implements CalendarSource {
  constructor(private upn: string) {}

  async listEvents(windowDays: number): Promise<CalendarEvent[]> {
    const now = new Date();
    const end = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.upn)}/calendarView`;
    const params = new URLSearchParams({
      startDateTime: now.toISOString(),
      endDateTime: end.toISOString(),
      $select: SELECT,
      $top: String(PAGE_SIZE),
      $orderby: "start/dateTime",
    });
    let url: string | null = `${base}?${params.toString()}`;

    const events: CalendarEvent[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res = await graphFetch(url, {
        headers: {
          // Two preferences in one header: instants in UTC, body as plain text.
          Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"',
        },
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) detail = `: ${body.error.message}`;
        } catch {
          /* non-JSON */
        }
        // 403 here is the signal that Calendars.Read / the Application Access
        // Policy (runbook §1c) is not in place yet — a visible, typed error.
        throw new GraphError(`calendarView ${res.status}${detail}`, "request", res.status);
      }
      const data = (await res.json()) as {
        value?: GraphEvent[];
        "@odata.nextLink"?: string;
      };
      for (const raw of data.value ?? []) {
        const norm = normalize(raw);
        if (norm) events.push(norm);
      }
      url = data["@odata.nextLink"] ?? null;
    }
    return events;
  }
}

// Null until the mailbox UPN is resolvable (same posture as the export config).
export function getGraphCalendarSource(): GraphCalendarSource | null {
  const upn = getGraphMailboxUpn();
  return upn ? new GraphCalendarSource(upn) : null;
}
