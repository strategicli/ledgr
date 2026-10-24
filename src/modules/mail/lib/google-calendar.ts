// Google Calendar provider: the CalendarProvider action list over the
// Calendar v3 REST API, primary calendar only. Plain fetch through
// googleFetch (google-auth.ts). teamsMeeting is Outlook-only and ignored here.
import { googleClient, googleFetch } from "./google-auth";
import { readMailStore } from "./store";
import {
  MailProviderError,
  type CalendarAttendee,
  type CalendarProvider,
  type EventInput,
  type MailAddress,
  type MailCalendarEvent,
} from "./types";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary";
const MAX_PAGES = 25;

type GAttendee = { email: string; displayName?: string; self?: boolean; responseStatus?: string; comment?: string };
type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: GAttendee[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

// Every Calendar call: googleFetch, JSON in and out, Google's own error
// message on a non-2xx. Empty bodies (DELETE) come back as {}.
async function cal<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = init.body ? { "content-type": "application/json" } : {};
  const res = await googleFetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } }).error?.message;
    throw new MailProviderError(msg ?? `Google Calendar request failed: ${res.status}`, "request", res.status);
  }
  return data as T;
}

const RESPONSES: Record<string, CalendarAttendee["response"]> = {
  accepted: "accepted",
  declined: "declined",
  tentative: "tentative",
};
// needsAction (and anything unknown) reads as "no answer yet".
const response = (s?: string): CalendarAttendee["response"] => RESPONSES[s ?? ""] ?? "none";

// All-day events carry a bare date; the screens want an ISO instant.
const iso = (t?: { date?: string; dateTime?: string }) =>
  t?.date ? `${t.date}T00:00:00.000Z` : t?.dateTime ? new Date(t.dateTime).toISOString() : "";

function toEvent(e: GEvent): MailCalendarEvent {
  const self = e.attendees?.find((a) => a.self);
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  return {
    id: e.id,
    account: "gmail",
    calendarId: "primary",
    title: e.summary ?? "",
    start: iso(e.start),
    end: iso(e.end),
    allDay: !!e.start?.date,
    location: e.location ?? null,
    organizer: e.organizer?.email ? { name: e.organizer.displayName ?? null, email: e.organizer.email } : null,
    attendees: (e.attendees ?? []).map((a) => ({
      name: a.displayName ?? null,
      email: a.email,
      response: response(a.responseStatus),
    })),
    myResponse: e.organizer?.self ? "organizer" : response(self?.responseStatus),
    joinUrl: e.hangoutLink ?? video ?? null,
    seriesId: e.recurringEventId ?? null,
    bodyPreview: e.description ? e.description.replace(/<[^>]*>/g, "").trim().slice(0, 200) : null,
    webLink: e.htmlLink ?? null,
  };
}

const when = (s: string, allDay: boolean) => (allDay ? { date: s.slice(0, 10) } : { dateTime: s });
const people = (l: MailAddress[]) => l.map((a) => ({ email: a.email, ...(a.name ? { displayName: a.name } : {}) }));

export class GoogleCalendarProvider implements CalendarProvider {
  readonly account = "gmail" as const;

  async listEvents(startIso: string, endIso: string): Promise<MailCalendarEvent[]> {
    const out: MailCalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const p = new URLSearchParams({
        timeMin: startIso,
        timeMax: endIso,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) p.set("pageToken", pageToken);
      const page = await cal<{ items?: GEvent[]; nextPageToken?: string }>(`/events?${p}`);
      out.push(...(page.items ?? []).map(toEvent));
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  async createEvent(input: EventInput): Promise<MailCalendarEvent> {
    const allDay = !!input.allDay;
    const body = {
      summary: input.title,
      start: when(input.start, allDay),
      end: when(input.end, allDay),
      ...(input.location ? { location: input.location } : {}),
      ...(input.body ? { description: input.body } : {}),
      ...(input.attendees?.length ? { attendees: people(input.attendees) } : {}),
    };
    return toEvent(await cal<GEvent>("/events?sendUpdates=all", { method: "POST", body: JSON.stringify(body) }));
  }

  async updateEvent(id: string, input: Partial<EventInput>): Promise<MailCalendarEvent> {
    const allDay = !!input.allDay;
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.summary = input.title;
    if (input.start !== undefined) body.start = when(input.start, allDay);
    if (input.end !== undefined) body.end = when(input.end, allDay);
    // null clears the field in a PATCH.
    if (input.location !== undefined) body.location = input.location;
    if (input.body !== undefined) body.description = input.body;
    if (input.attendees !== undefined) body.attendees = people(input.attendees);
    return toEvent(
      await cal<GEvent>(`/events/${encodeURIComponent(id)}?sendUpdates=all`, { method: "PATCH", body: JSON.stringify(body) })
    );
  }

  async deleteEvent(id: string): Promise<void> {
    await cal(`/events/${encodeURIComponent(id)}?sendUpdates=all`, { method: "DELETE" });
  }

  async respond(id: string, answer: "accept" | "decline" | "tentative", comment?: string): Promise<void> {
    const path = `/events/${encodeURIComponent(id)}`;
    const ev = await cal<GEvent>(path);
    const attendees = ev.attendees ?? [];
    if (!attendees.some((a) => a.self)) throw new MailProviderError("You are not an attendee of this event", "request");
    const status = { accept: "accepted", decline: "declined", tentative: "tentative" }[answer];
    // PATCH replaces the attendees array whole, so send everyone back and
    // change only the self entry.
    const next = attendees.map((a) => (a.self ? { ...a, responseStatus: status, ...(comment ? { comment } : {}) } : a));
    await cal(`${path}?sendUpdates=all`, { method: "PATCH", body: JSON.stringify({ attendees: next }) });
  }
}

export function getGoogleCalendar(): GoogleCalendarProvider | null {
  if (!googleClient() || !readMailStore().google?.refreshToken) return null;
  return new GoogleCalendarProvider();
}
