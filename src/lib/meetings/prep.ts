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

export type PrepPerson = { id: string; title: string };
type ListRow = Awaited<ReturnType<typeof queryViewItems>>[number];

export type MeetingPrep = {
  people: PrepPerson[];
  openTasks: ListRow[];
  recentMeetings: ListRow[];
  // The template a matcher chose (slice 23), if any — shown as a hint; the
  // full named-template system (agenda per template) is Phase 3.
  templateName: string | null;
};

const RECENT_MEETINGS = 3;

// The meeting's confirmed related people (both directions), title order.
export async function getMeetingPeople(
  ownerId: string,
  meetingId: string
): Promise<PrepPerson[]> {
  const rows = await getDb().execute(sql`
    select distinct e.id, e.title
    from relations r
    join items e
      on e.id = case when r.source_id = ${meetingId} then r.target_id else r.source_id end
    where (r.source_id = ${meetingId} or r.target_id = ${meetingId})
      and r.match_state = 'confirmed'
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
    .select({ properties: items.properties })
    .from(items)
    .where(and(eq(items.id, meetingId), eq(items.ownerId, ownerId), isNull(items.deletedAt)));
  const templateName =
    ((self[0]?.properties as { match?: { templateName?: string | null } } | null)?.match
      ?.templateName) ?? null;

  const people = await getMeetingPeople(ownerId, meetingId);
  if (people.length === 0) {
    return { people, openTasks: [], recentMeetings: [], templateName };
  }

  // Per-person queries (people per meeting are few) reusing the tested
  // viewItemsQuery relatedTo filter; merge + dedupe across people.
  const openTasksNested = await Promise.all(
    people.map((e) =>
      queryViewItems(
        ownerId,
        { type: "task", statusCategory: "active", relatedTo: e.id },
        { field: "dueDate", dir: "asc" },
        50
      )
    )
  );
  const recentNested = await Promise.all(
    people.map((e) =>
      queryViewItems(
        ownerId,
        { type: "event", relatedTo: e.id },
        { field: "meetingAt", dir: "desc" },
        RECENT_MEETINGS + 1 // room to drop this meeting before slicing
      )
    )
  );

  const openTasks = dedupeById(openTasksNested.flat());
  const recentMeetings = dedupeById(recentNested.flat())
    .filter((m) => m.id !== meetingId)
    .sort((a, b) => (b.meetingAt?.getTime() ?? 0) - (a.meetingAt?.getTime() ?? 0))
    .slice(0, RECENT_MEETINGS);

  return { people, openTasks, recentMeetings, templateName };
}
