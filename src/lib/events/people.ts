// The unified event-people model (ADR-144). An event's people live in ONE
// mental model with strata, all over the same generic relations table:
//   - "For"  : the group(s) driving the meeting — event→group, role 'group'
//              (a confirmed edge to a `group`-type item in ANY role counts, so
//              a tag-turned-group keeps working through its legacy 'tags' edges)
//   - "Here" : individuals present — event↔person, role 'attending', confirmed
//   - "Out"  : individuals who'd normally be here but weren't — role 'absent'.
//              An explicit edge, not a silent gap, so "what did Roger miss?"
//              stays answerable later. Memory, not attendance-tracking.
//   - ghosts : roster members (the group's 'members' edges) with no edge yet,
//              plus suggested-state person edges — proposals awaiting ✓/✕
//   - mentioned: @-mentions and loose 'related' links — the body/panel owns
//              those; the card only reads them.
// Roles are data, not schema: an instance without a `group` type or an
// 'attending' field just sees empty strata. Owner-scoped, body-free reads.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { relateItems, unrelateItems } from "@/lib/relations";

export const ATTENDING_ROLE = "attending";
export const ABSENT_ROLE = "absent";
// The event→group "this meeting is for …" edge written going forward. Reads
// accept any confirmed role so converted tags' historical edges still count.
export const EVENT_GROUP_ROLE = "group";
// The group→person roster edge — the group type's Members relation field key.
export const GROUP_MEMBERS_ROLE = "members";
export const GROUP_TYPE = "group";

export type EventPerson = { id: string; title: string };
export type EventGroup = { id: string; title: string; memberCount: number };

export type EventPeople = {
  groups: EventGroup[];
  attending: EventPerson[];
  absent: EventPerson[];
  // Roster members with no attending/absent edge yet — the "probably here"
  // ghosts. Distinct from `suggested` so the card can order roster first.
  expected: EventPerson[];
  // Suggested-state DB edges (the old matcher wrote these); the live
  // suggester's guesses are merged in by the caller (they're event-shaped).
  suggested: EventPerson[];
  mentioned: EventPerson[];
};

const byTitle = (a: EventPerson, b: EventPerson) => a.title.localeCompare(b.title);

// One both-directions pass over the event's person/group edges, bucketed by
// stratum. A person with several edges lands in exactly one bucket:
// attending > absent > mentioned > suggested.
export async function getEventPeople(
  ownerId: string,
  eventId: string
): Promise<EventPeople> {
  const res = await getDb().execute(sql`
    select i.id, i.title, i.type, r.role, r.match_state
    from relations r
    join items i
      on i.id = case when r.source_id = ${eventId} then r.target_id else r.source_id end
    where (r.source_id = ${eventId} or r.target_id = ${eventId})
      and i.type in ('person', ${GROUP_TYPE})
      and i.owner_id = ${ownerId}
      and i.deleted_at is null
      and i.is_template = false
      and i.id <> ${eventId}
  `);
  const rows = res.rows as {
    id: string;
    title: string;
    type: string;
    role: string;
    match_state: "confirmed" | "suggested";
  }[];

  const groups = new Map<string, EventGroup>();
  // Per-person stratum, upgraded by priority as edges accumulate.
  const RANK = { attending: 3, absent: 2, mentioned: 1, suggested: 0 } as const;
  const people = new Map<string, { title: string; bucket: keyof typeof RANK }>();
  for (const r of rows) {
    if (r.type === GROUP_TYPE) {
      if (r.match_state === "confirmed") {
        groups.set(r.id, { id: r.id, title: r.title, memberCount: 0 });
      }
      continue;
    }
    const bucket: keyof typeof RANK =
      r.match_state === "suggested"
        ? "suggested"
        : r.role === ATTENDING_ROLE
          ? "attending"
          : r.role === ABSENT_ROLE
            ? "absent"
            : "mentioned";
    const seen = people.get(r.id);
    if (!seen || RANK[bucket] > RANK[seen.bucket]) {
      people.set(r.id, { title: r.title, bucket });
    }
  }

  // Roster: the groups' members (group→person 'members' edges, the relation
  // field's direction), for the counts and the expected ghosts.
  const membersByGroup = await groupMembers(ownerId, [...groups.keys()]);
  for (const [gid, members] of membersByGroup) {
    const g = groups.get(gid);
    if (g) g.memberCount = members.length;
  }

  const pick = (bucket: keyof typeof RANK): EventPerson[] =>
    [...people.entries()]
      .filter(([, v]) => v.bucket === bucket)
      .map(([id, v]) => ({ id, title: v.title }))
      .sort(byTitle);

  const attending = pick("attending");
  const absent = pick("absent");
  const mentioned = pick("mentioned");
  const suggested = pick("suggested");

  // Expected = roster minus anyone already resolved (or otherwise present).
  const resolved = new Set([...people.keys()]);
  const expected = [...membersByGroup.values()]
    .flat()
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
    .filter((m) => !resolved.has(m.id))
    .sort(byTitle);

  return {
    groups: [...groups.values()].sort((a, b) => a.title.localeCompare(b.title)),
    attending,
    absent,
    expected,
    suggested,
    mentioned,
  };
}

// The groups' rosters in one query: group→person edges with the Members
// field's role, live people only. Both-direction tolerant on purpose — a
// hand-made person→group 'members' edge still counts.
export async function groupMembers(
  ownerId: string,
  groupIds: string[]
): Promise<Map<string, EventPerson[]>> {
  const out = new Map<string, EventPerson[]>();
  for (const id of groupIds) out.set(id, []);
  if (groupIds.length === 0) return out;
  const rows = await getDb()
    .select({
      groupId: sql<string>`case when ${inArray(relations.sourceId, groupIds)} then ${relations.sourceId} else ${relations.targetId} end`,
      id: items.id,
      title: items.title,
    })
    .from(relations)
    .innerJoin(
      items,
      or(
        and(inArray(relations.sourceId, groupIds), eq(items.id, relations.targetId)),
        and(inArray(relations.targetId, groupIds), eq(items.id, relations.sourceId))
      )
    )
    .where(
      and(
        eq(relations.role, GROUP_MEMBERS_ROLE),
        eq(relations.matchState, "confirmed"),
        eq(items.type, "person"),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );
  for (const r of rows) {
    const arr = out.get(r.groupId);
    if (arr && !arr.some((m) => m.id === r.id)) arr.push({ id: r.id, title: r.title });
  }
  for (const arr of out.values()) arr.sort(byTitle);
  return out;
}

export type AttendanceState = "here" | "absent" | "none";

// Resolve one person's attendance on an event. 'here' and 'absent' are
// mutually exclusive (the opposite edge is removed first); either also clears
// any suggested-state edges between the pair — resolving IS the ✓/✕ gesture.
// 'none' removes both marks (the chip-remove gesture); mention/related edges
// are never touched here (the body/panel owns those).
export async function setAttendance(
  ownerId: string,
  eventId: string,
  personId: string,
  state: AttendanceState
): Promise<void> {
  await unrelateItems(ownerId, eventId, personId, { suggestedOnly: true });
  if (state === "here") {
    await unrelateItems(ownerId, eventId, personId, { role: ABSENT_ROLE });
    await relateItems(ownerId, eventId, personId, ATTENDING_ROLE);
  } else if (state === "absent") {
    await unrelateItems(ownerId, eventId, personId, { role: ATTENDING_ROLE });
    await relateItems(ownerId, eventId, personId, ABSENT_ROLE);
  } else {
    await unrelateItems(ownerId, eventId, personId, { role: ATTENDING_ROLE });
    await unrelateItems(ownerId, eventId, personId, { role: ABSENT_ROLE });
  }
}

// A meeting a person was marked OUT of (ADR-144 Phase 3): the payoff of
// recording absence. When prepping a 1:1 with someone, surface the recent
// meetings they missed so you can catch them up — "Roger missed All Pastors
// Meeting, Jun 2" with the meeting (its agenda / notes / tasks) one click away.
export type MissedMeeting = {
  personId: string;
  personTitle: string;
  meetingId: string;
  meetingTitle: string;
  meetingAt: Date | null;
};

// The recent PAST meetings these people were marked absent from, newest first.
// Absent edges are written event→person (setAttendance), so we match that
// direction. Owner-scoped, body-free, live events only; a future-dated meeting
// can't have been "missed" yet, so only meetings on/before now count. Capped
// per person AND overall so a group meeting's prep can't explode. `excludeId`
// drops the event being prepped (defensive — it holds no absent edge for its
// own attendees anyway).
export async function getMissedMeetings(
  ownerId: string,
  personIds: string[],
  opts: { perPerson?: number; total?: number; excludeId?: string } = {}
): Promise<MissedMeeting[]> {
  if (personIds.length === 0) return [];
  const perPerson = opts.perPerson ?? 3;
  const total = opts.total ?? 6;
  const res = await getDb().execute(sql`
    with missed as (
      select
        p.id as person_id, p.title as person_title,
        ev.id as meeting_id, ev.title as meeting_title, ev.meeting_at,
        row_number() over (partition by p.id order by ev.meeting_at desc nulls last) as rn
      from relations r
      join items p on p.id = r.target_id
      join items ev on ev.id = r.source_id
      where r.role = ${ABSENT_ROLE}
        and r.target_id in (
          select (value)::uuid from jsonb_array_elements_text(${JSON.stringify(personIds)}::jsonb) as value
        )
        and p.owner_id = ${ownerId} and p.deleted_at is null
        and ev.type = 'event' and ev.owner_id = ${ownerId} and ev.deleted_at is null
        and ev.is_template = false
        and (ev.meeting_at is null or ev.meeting_at <= now())
        ${opts.excludeId ? sql`and ev.id <> ${opts.excludeId}` : sql``}
    )
    select person_id, person_title, meeting_id, meeting_title, meeting_at
    from missed
    where rn <= ${perPerson}
    order by meeting_at desc nulls last
    limit ${total}
  `);
  return (res.rows as {
    person_id: string;
    person_title: string;
    meeting_id: string;
    meeting_title: string;
    meeting_at: Date | string | null;
  }[]).map((r) => ({
    personId: r.person_id,
    personTitle: r.person_title,
    meetingId: r.meeting_id,
    meetingTitle: r.meeting_title,
    meetingAt: r.meeting_at ? new Date(r.meeting_at) : null,
  }));
}

// "✓ all here": confirm every unresolved roster member (expected ghosts) as
// attending in one gesture. Already-resolved people (attending OR absent) are
// left alone, so marking one person OUT then confirming the rest is safe in
// either order. Returns how many edges were written.
export async function confirmRoster(
  ownerId: string,
  eventId: string
): Promise<number> {
  const { expected } = await getEventPeople(ownerId, eventId);
  let added = 0;
  for (const m of expected) {
    try {
      await relateItems(ownerId, eventId, m.id, ATTENDING_ROLE);
      added++;
    } catch {
      // a member trashed mid-flight — skip, the rest still confirm
    }
  }
  return added;
}
