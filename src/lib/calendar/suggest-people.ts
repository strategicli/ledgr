// Person suggester (EM2, ADR-123). Deterministic, no model in the loop: given a
// calendar event, GUESS which of the owner's people it's about, from two signals
// preferring structured data over text (PRD §5.1):
//   1. attendee/organizer email → a person who stores that email (exact, high).
//   2. title/details token containment → a person whose name token appears as a
//      whole word in the event title (e.g. "Roger/Brandon 1:1" → Roger Knowlton)
//      (medium). A full-title pg_trgm fallback (low) only fires when 1+2 miss.
// Suggestions are proposals to confirm, never auto-confirmed. They are computed
// LIVE on the event canvas (getMeetingPrep) and offered with a one-click add —
// not pre-written as edges. The owner is always excluded: their own person id
// and name tokens are resolved once and filtered out, so a meeting "with" the
// owner never suggests the owner.
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, users } from "@/db/schema";
import type { CalendarEvent, CalendarPerson } from "./types";

// Build the minimal CalendarEvent the suggester needs from a stored `event`
// ITEM, so suggestions can be computed LIVE on the canvas for ANY event (not
// only ones freshly Added from the calendar feed). Calendar-sourced events carry
// attendees/organizer/series in properties.calendar; a hand-made event has just
// its title, and the title-token signal still works.
export function eventItemToCalendarEvent(item: {
  title: string | null;
  properties: unknown;
}): CalendarEvent {
  const cal =
    (item.properties as {
      calendar?: {
        attendees?: CalendarPerson[];
        organizer?: CalendarPerson | null;
        seriesMasterId?: string | null;
        location?: string | null;
        bodyPreview?: string | null;
      };
    } | null)?.calendar ?? {};
  return {
    id: "",
    title: item.title ?? "",
    startUtc: new Date(),
    endUtc: null,
    isCancelled: false,
    organizer: cal.organizer ?? null,
    attendees: Array.isArray(cal.attendees) ? cal.attendees : [],
    location: cal.location ?? null,
    isOnline: false,
    joinUrl: null,
    webLink: null,
    seriesMasterId: cal.seriesMasterId ?? null,
    bodyPreview: cal.bodyPreview ?? null,
    lastModified: null,
  };
}

export type PersonSuggestion = {
  personId: string;
  title: string;
  confidence: "high" | "medium" | "low";
  reason: "attendeeEmail" | "titleToken" | "titleFuzzy";
};

// Generic meeting words that aren't names — kept out of the title token set so
// they can't accidentally match a person. Small on purpose (Principle 5).
const STOPWORDS = new Set([
  "the", "and", "for", "with", "meeting", "mtg", "call", "sync", "check",
  "catch", "weekly", "monthly", "biweekly", "prep", "review", "standup",
  "huddle", "lunch", "coffee", "zoom", "teams", "google", "meet", "intro",
]);

// Split a string into lowercased word tokens; `min` length floor.
function tokens(text: string, min: number): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= min);
}

// The owner's own person id(s) + name tokens, resolved via their users.email →
// the person item that stores it. Both are excluded from every signal.
async function resolveOwnerExclusion(
  ownerId: string
): Promise<{ emails: string[]; personIds: Set<string>; nameTokens: Set<string> }> {
  const db = getDb();
  const u = await db.select({ email: users.email }).from(users).where(eq(users.id, ownerId));
  const ownerEmail = u[0]?.email?.toLowerCase() ?? null;
  const personIds = new Set<string>();
  const nameTokens = new Set<string>();
  const emails: string[] = [];
  if (ownerEmail) {
    emails.push(ownerEmail);
    const own = await db
      .select({ id: items.id, title: items.title })
      .from(items)
      .where(
        and(
          eq(items.type, "person"),
          eq(items.ownerId, ownerId),
          isNull(items.deletedAt),
          eq(items.isTemplate, false),
          sql`lower(${items.properties} ->> 'email') = ${ownerEmail}`
        )
      );
    for (const p of own) {
      personIds.add(p.id);
      for (const t of tokens(p.title ?? "", 2)) nameTokens.add(t);
    }
  }
  return { emails, personIds, nameTokens };
}

function eventEmails(e: CalendarEvent): string[] {
  const s = new Set<string>();
  for (const a of e.attendees) if (a.email) s.add(a.email.toLowerCase());
  if (e.organizer?.email) s.add(e.organizer.email.toLowerCase());
  return [...s];
}

// Signal 1: people whose stored email matches an event attendee/organizer.
async function byEmail(
  ownerId: string,
  emails: string[],
  excludeIds: Set<string>
): Promise<PersonSuggestion[]> {
  if (emails.length === 0) return [];
  const res = await getDb().execute(sql`
    with want as (
      select distinct lower(value) as e
      from jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb) as value
    )
    select i.id, i.title
    from items i
    join want on want.e = lower(i.properties ->> 'email')
    where i.type = 'person' and i.owner_id = ${ownerId}
      and i.deleted_at is null and i.is_template = false
  `);
  return (res.rows as { id: string; title: string }[])
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => ({ personId: r.id, title: r.title, confidence: "high", reason: "attendeeEmail" }));
}

// Signal 2: people a name token of whom appears as a whole word in the title
// (and details). Owner name tokens are pre-removed from the title set.
async function byTitleToken(
  ownerId: string,
  titleTokens: string[],
  excludeIds: Set<string>
): Promise<PersonSuggestion[]> {
  if (titleTokens.length === 0) return [];
  const res = await getDb().execute(sql`
    with title_tokens as (
      select distinct value as tok
      from jsonb_array_elements_text(${JSON.stringify(titleTokens)}::jsonb) as value
    ),
    ptok as (
      select i.id, i.title, t.tok as ptok
      from items i
      cross join lateral unnest(regexp_split_to_array(lower(i.title), '[^a-z0-9]+')) as t(tok)
      where i.type = 'person' and i.owner_id = ${ownerId}
        and i.deleted_at is null and i.is_template = false
    )
    select p.id, p.title, count(*)::int as hits
    from ptok p
    join title_tokens tt on tt.tok = p.ptok
    where length(p.ptok) >= 3
    group by p.id, p.title
    order by hits desc
    limit 25
  `);
  // Multi-token names (first + last) rank above single-token names; within a
  // tier, more matched tokens first.
  return (res.rows as { id: string; title: string; hits: number }[])
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => ({
      personId: r.id,
      title: r.title,
      confidence: "medium" as const,
      reason: "titleToken" as const,
      _multi: tokens(r.title ?? "", 2).length >= 2,
      _hits: r.hits,
    }))
    .sort((a, b) => Number(b._multi) - Number(a._multi) || b._hits - a._hits)
    .map(({ personId, title, confidence, reason }) => ({ personId, title, confidence, reason }));
}

// Signal 3 (last resort): full-title pg_trgm word_similarity, only when 1+2 miss.
async function byTitleFuzzy(
  ownerId: string,
  title: string,
  excludeIds: Set<string>
): Promise<PersonSuggestion[]> {
  if (!title.trim()) return [];
  const res = await getDb().execute(sql`
    select i.id, i.title, word_similarity(lower(i.title), lower(${title})) as sim
    from items i
    where i.type = 'person' and i.owner_id = ${ownerId}
      and i.deleted_at is null and i.is_template = false
      and word_similarity(lower(i.title), lower(${title})) >= 0.45
    order by sim desc
    limit 5
  `);
  return (res.rows as { id: string; title: string; sim: number }[])
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => ({ personId: r.id, title: r.title, confidence: "low", reason: "titleFuzzy" }));
}

// Ranked, deduped, capped people suggestions for an event. email > token >
// fuzzy; the fuzzy fallback is consulted only when the first two return nothing.
export async function suggestPeopleForEvent(
  ownerId: string,
  event: CalendarEvent,
  opts: { limit?: number } = {}
): Promise<PersonSuggestion[]> {
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 10);
  const { emails: ownerEmails, personIds: ownerIds, nameTokens: ownerTokens } =
    await resolveOwnerExclusion(ownerId);

  const ownerEmailSet = new Set(ownerEmails);
  const emails = eventEmails(event).filter((e) => !ownerEmailSet.has(e));

  // Title + light details, owner name tokens and meeting stopwords removed.
  const detailText = [event.title, event.location ?? "", event.bodyPreview ?? ""].join(" ");
  const titleTokens = [
    ...new Set(tokens(detailText, 3).filter((t) => !ownerTokens.has(t) && !STOPWORDS.has(t))),
  ];

  const [emailHits, tokenHits] = await Promise.all([
    byEmail(ownerId, emails, ownerIds),
    byTitleToken(ownerId, titleTokens, ownerIds),
  ]);

  // Merge email then token, dedupe by personId (first/highest tier wins).
  const seen = new Set<string>();
  const out: PersonSuggestion[] = [];
  for (const s of [...emailHits, ...tokenHits]) {
    if (seen.has(s.personId)) continue;
    seen.add(s.personId);
    out.push(s);
  }

  // Fuzzy is the last resort: only when nothing structured surfaced.
  if (out.length === 0) {
    for (const s of await byTitleFuzzy(ownerId, event.title, ownerIds)) {
      if (seen.has(s.personId)) continue;
      seen.add(s.personId);
      out.push(s);
    }
  }

  return out.slice(0, limit);
}
