// Meeting prep assembly (slice 24, PRD §5.1). Deterministic, no model in the
// loop: given a meeting, gather the related person's open tasks and the
// last few meetings with them. This is the Phase 2 forerunner of the general
// per-type item template (roadmap Phase 3). Reads only — owner-scoped,
// body-free, confirmed edges only (a provisional calendar match must not shape
// prep, PRD §3.3).
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { queryViewItems } from "@/lib/views";
import {
  resolveEventTaskPull,
  taskPullSeedLabels,
} from "@/lib/events/task-pull-service";
import { effectiveTaskPull, type TaskPull } from "@/lib/events/task-pull";
import {
  eventItemToCalendarEvent,
  suggestPeopleForEvent,
} from "@/lib/calendar/suggest-people";
import { getTemplate } from "@/lib/templates";

export type PrepPerson = { id: string; title: string };
type ListRow = Awaited<ReturnType<typeof queryViewItems>>[number];

export type MeetingPrep = {
  people: PrepPerson[];
  // Live person guesses for this event (ADR-123) — attendee email + fuzzy title,
  // owner-excluded, minus the people already confirmed-related. Computed LIVE so
  // it works for ANY event (not only ones Added from the calendar feed); the
  // canvas offers a one-click add for each.
  suggestedPeople: PrepPerson[];
  openTasks: ListRow[];
  recentMeetings: ListRow[];
  // The template a rule applied (ADR-123), if any — shown as a hint chip; the
  // prototype id lets the chip link to the template (to edit / unpin the rule).
  templateName: string | null;
  templatePrototypeId: string | null;
  // The event's effective task-pull rule (ADR-094 E4) + labels for its concrete
  // seeds, for the TaskPullControl. The default rule = tasks related to anyone
  // on the event.
  taskPull: TaskPull;
  taskPullSeeds: { id: string; title: string; type: string }[];
};

const RECENT_MEETINGS = 3;

// The meeting's related people (both directions), title order, for one trust
// level — confirmed (the real attendees, default) or suggested (provisional
// guesses awaiting ✓/✕). Same query, one `match_state` filter.
export async function getMeetingPeople(
  ownerId: string,
  meetingId: string,
  matchState: "confirmed" | "suggested" = "confirmed"
): Promise<PrepPerson[]> {
  const rows = await getDb().execute(sql`
    select distinct e.id, e.title
    from relations r
    join items e
      on e.id = case when r.source_id = ${meetingId} then r.target_id else r.source_id end
    where (r.source_id = ${meetingId} or r.target_id = ${meetingId})
      and r.match_state = ${matchState}
      and e.type = 'person'
      and e.owner_id = ${ownerId}
      and e.deleted_at is null
    order by e.title
  `);
  return rows.rows as PrepPerson[];
}

function dedupeById(rows: ListRow[]): ListRow[] {
  const seen = new Set<string>();
  const out: ListRow[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export async function getMeetingPrep(
  ownerId: string,
  meetingId: string
): Promise<MeetingPrep> {
  // The matched template name, if a matcher recorded one (slice 23).
  const self = await getDb()
    .select({ title: items.title, properties: items.properties })
    .from(items)
    .where(and(eq(items.id, meetingId), eq(items.ownerId, ownerId), isNull(items.deletedAt)));
  const match = (self[0]?.properties as { match?: { templateName?: string | null; templateId?: string | null } } | null)?.match;
  const templateName = match?.templateName ?? null;
  // Resolve the rule's template → its prototype, so the chip can link to it (to
  // edit or unpin the rule). Tolerate a since-deleted template.
  let templatePrototypeId: string | null = null;
  if (match?.templateId) {
    try {
      templatePrototypeId = (await getTemplate(ownerId, match.templateId)).prototypeItemId;
    } catch {
      /* template gone — leave the chip unlinked */
    }
  }

  const people = await getMeetingPeople(ownerId, meetingId, "confirmed");
  const peopleIds = people.map((p) => p.id);

  // Live person guesses (ADR-123): run the suggester over this event item every
  // render, minus the people already confirmed-related — so opening ANY event
  // shows suggestions, not just ones Added through the calendar feed.
  const confirmedIds = new Set(peopleIds);
  const guesses = self[0]
    ? await suggestPeopleForEvent(
        ownerId,
        eventItemToCalendarEvent({ title: self[0].title, properties: self[0].properties }),
        { limit: 6 }
      )
    : [];
  const suggestedPeople: PrepPerson[] = guesses
    .filter((g) => !confirmedIds.has(g.personId))
    .slice(0, 3)
    .map((g) => ({ id: g.personId, title: g.title }));
  const rawRule = (self[0]?.properties as { taskPull?: unknown } | null)?.taskPull;
  const rule = effectiveTaskPull(rawRule);

  // Open tasks come from the event's configurable pull rule (ADR-094 E4; default
  // = tasks related to anyone on the event). Recent meetings stay people-driven.
  const [openTasks, taskPullSeeds, recentNested] = await Promise.all([
    resolveEventTaskPull(ownerId, rawRule, peopleIds),
    taskPullSeedLabels(ownerId, rule),
    people.length === 0
      ? Promise.resolve([] as ListRow[][])
      : Promise.all(
          people.map((e) =>
            queryViewItems(
              ownerId,
              { type: "event", relatedTo: e.id },
              { field: "meetingAt", dir: "desc" },
              RECENT_MEETINGS + 1 // room to drop this meeting before slicing
            )
          )
        ),
  ]);

  const recentMeetings = dedupeById(recentNested.flat())
    .filter((m) => m.id !== meetingId)
    .sort((a, b) => (b.meetingAt?.getTime() ?? 0) - (a.meetingAt?.getTime() ?? 0))
    .slice(0, RECENT_MEETINGS);

  return { people, suggestedPeople, openTasks, recentMeetings, templateName, templatePrototypeId, taskPull: rule, taskPullSeeds };
}
