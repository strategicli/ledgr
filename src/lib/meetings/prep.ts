// Meeting prep assembly (slice 24, PRD §5.1; people model unified by ADR-144).
// Deterministic, no model in the loop: given a meeting, gather who's involved
// (group + attendance strata), their open tasks, and the last few meetings in
// the same context. Reads only — owner-scoped, body-free, confirmed edges only
// (a provisional calendar match must not shape prep, PRD §3.3).
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { queryViewItems } from "@/lib/views";
import {
  ATTENDING_ROLE,
  getEventPeople,
  getMissedMeetings,
  type EventGroup,
  type EventPerson,
  type MissedMeeting,
} from "@/lib/events/people";
import {
  resolveEventTaskPull,
  taskPullSeedLabels,
} from "@/lib/events/task-pull-service";
import {
  DEFAULT_TASK_PULL,
  EVENT_PEOPLE_SEED,
  parseTaskPull,
  type TaskPull,
} from "@/lib/events/task-pull";
import {
  eventItemToCalendarEvent,
  suggestPeopleForEvent,
} from "@/lib/calendar/suggest-people";
import { getTemplate } from "@/lib/templates";

export type PrepPerson = EventPerson;
type ListRow = Awaited<ReturnType<typeof queryViewItems>>[number];

// An unresolved chip on the People card: a roster member with no edge yet
// (✕ marks them OUT) or a suggestion — a suggested-state DB edge or a live
// guess (✕ dismisses).
export type PrepGhost = EventPerson & { kind: "roster" | "suggestion" };

// Which preset the event's pull rule corresponds to, for the lens pills.
// "group" = items about the meeting's group(s) — the default when a group is
// set; "anyone"/"everyone" = union/intersection over the people here;
// "custom" = a hand-built rule (the full TaskPullControl).
export type PullPreset = "group" | "anyone" | "everyone" | "custom";

export type MeetingPrep = {
  groups: EventGroup[];
  attending: PrepPerson[];
  absent: PrepPerson[];
  ghosts: PrepGhost[];
  mentioned: PrepPerson[];
  openTasks: ListRow[];
  recentMeetings: ListRow[];
  // Recent meetings the attendees were marked OUT of (ADR-144 Phase 3), so a
  // 1:1's prep can flag "here's what they missed." Empty when no one here has a
  // recent absence.
  missedMeetings: MissedMeeting[];
  // The template a rule applied (ADR-123), if any — shown as a hint chip; the
  // prototype id lets the chip link to the template (to edit / unpin the rule).
  templateName: string | null;
  templatePrototypeId: string | null;
  // The event's effective task-pull rule (ADR-094 E4) + labels for its concrete
  // seeds, for the custom control. With no stored rule the default is the
  // meeting's group(s) when set, else tasks related to anyone here (ADR-144).
  taskPull: TaskPull;
  taskPullSeeds: { id: string; title: string; type: string }[];
  pullPreset: PullPreset;
};

const RECENT_MEETINGS = 3;
const LIVE_SUGGESTIONS = 3;

// The meeting's people for one trust level. Confirmed = the real attendees
// (role 'attending' only, ADR-144 — a loose 'related' link or @-mention is not
// attendance); suggested = provisional edges in any role awaiting ✓/✕.
export async function getMeetingPeople(
  ownerId: string,
  meetingId: string,
  matchState: "confirmed" | "suggested" = "confirmed"
): Promise<PrepPerson[]> {
  const roleFilter =
    matchState === "confirmed" ? sql` and r.role = ${ATTENDING_ROLE}` : sql``;
  const rows = await getDb().execute(sql`
    select distinct e.id, e.title
    from relations r
    join items e
      on e.id = case when r.source_id = ${meetingId} then r.target_id else r.source_id end
    where (r.source_id = ${meetingId} or r.target_id = ${meetingId})
      and r.match_state = ${matchState}${roleFilter}
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

// Map a stored rule (or its absence) to the lens pill it corresponds to.
function detectPreset(raw: unknown, groupIds: string[]): PullPreset {
  const rule = parseTaskPull(raw);
  if (!rule) return groupIds.length > 0 ? "group" : "anyone";
  if (rule.groups.length === 1 && rule.statusScope === "active") {
    const g = rule.groups[0];
    if (g.seeds.length === 1 && g.seeds[0] === EVENT_PEOPLE_SEED) {
      return g.match === "all" ? "everyone" : "anyone";
    }
    if (
      g.match === "any" &&
      g.seeds.length > 0 &&
      g.seeds.every((s) => groupIds.includes(s))
    ) {
      return "group";
    }
  }
  return "custom";
}

export async function getMeetingPrep(
  ownerId: string,
  meetingId: string
): Promise<MeetingPrep> {
  // The matched template name, if a rule recorded one (ADR-123).
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

  const people = await getEventPeople(ownerId, meetingId);
  const attendingIds = people.attending.map((p) => p.id);
  const groupIds = people.groups.map((g) => g.id);

  // Live person guesses (ADR-123): run the suggester over this event item every
  // render, minus everyone the card already accounts for — so opening ANY event
  // shows suggestions, not just ones Added through the calendar feed.
  const accounted = new Set([
    ...attendingIds,
    ...people.absent.map((p) => p.id),
    ...people.expected.map((p) => p.id),
    ...people.suggested.map((p) => p.id),
    ...people.mentioned.map((p) => p.id),
  ]);
  const guesses = self[0]
    ? await suggestPeopleForEvent(
        ownerId,
        eventItemToCalendarEvent({ title: self[0].title, properties: self[0].properties }),
        { limit: LIVE_SUGGESTIONS * 2 }
      )
    : [];
  const liveSuggested: PrepPerson[] = guesses
    .filter((g) => !accounted.has(g.personId))
    .slice(0, LIVE_SUGGESTIONS)
    .map((g) => ({ id: g.personId, title: g.title }));

  // One ghost list for the card: roster first (✕ = OUT), then suggestions
  // (DB suggested edges + live guesses; ✕ = dismiss).
  const ghosts: PrepGhost[] = [
    ...people.expected.map((p) => ({ ...p, kind: "roster" as const })),
    ...people.suggested.map((p) => ({ ...p, kind: "suggestion" as const })),
    ...liveSuggested.map((p) => ({ ...p, kind: "suggestion" as const })),
  ];

  const rawRule = (self[0]?.properties as { taskPull?: unknown } | null)?.taskPull;
  // No stored rule + a group set → the group IS the lens (ADR-144); else the
  // classic default (anyone here).
  const groupDefault: TaskPull | undefined =
    groupIds.length > 0
      ? { groups: [{ match: "any", seeds: groupIds }], statusScope: "active" }
      : undefined;
  const rule = parseTaskPull(rawRule) ?? groupDefault ?? DEFAULT_TASK_PULL;
  const pullPreset = detectPreset(rawRule, groupIds);

  // Open tasks come from the pull rule. Recent meetings follow the same lens
  // idea: group-driven when a group is set (every meeting linked to the group,
  // however it was linked), else the attendees' meetings.
  const recentAnchors = groupIds.length > 0 ? groupIds : attendingIds;
  const [openTasks, taskPullSeeds, recentNested, missedMeetings] = await Promise.all([
    resolveEventTaskPull(ownerId, rule, attendingIds),
    taskPullSeedLabels(ownerId, rule),
    recentAnchors.length === 0
      ? Promise.resolve([] as ListRow[][])
      : Promise.all(
          recentAnchors.map((id) =>
            queryViewItems(
              ownerId,
              { type: "event", relatedTo: id },
              { field: "meetingAt", dir: "desc" },
              RECENT_MEETINGS + 1 // room to drop this meeting before slicing
            )
          )
        ),
    // "What did they miss?" — the recent meetings this event's attendees were
    // marked OUT of (ADR-144 Phase 3). Keyed off the people HERE, not the group.
    getMissedMeetings(ownerId, attendingIds, { excludeId: meetingId }),
  ]);

  const recentMeetings = dedupeById(recentNested.flat())
    .filter((m) => m.id !== meetingId)
    .sort((a, b) => (b.meetingAt?.getTime() ?? 0) - (a.meetingAt?.getTime() ?? 0))
    .slice(0, RECENT_MEETINGS);

  return {
    groups: people.groups,
    attending: people.attending,
    absent: people.absent,
    ghosts,
    mentioned: people.mentioned,
    openTasks,
    recentMeetings,
    missedMeetings,
    templateName,
    templatePrototypeId,
    taskPull: rule,
    taskPullSeeds,
    pullPreset,
  };
}
