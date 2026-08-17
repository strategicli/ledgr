// The project review timeline's data (ADR-198, Tyler's everything-timeline —
// explorations/project-review-timeline.md): every dated thing that happened in
// a record, merged into one ascending history. Two tiers, decided here so the
// page renders without policy:
//
//   BIG   — meetings, milestones (due or completed), and the record's own
//           creation (the story's opening line): the h2s of the scroll.
//   SMALL — task completions, notes made, links added: the ticks between them.
//
// Same source rules as the Timeline card and the project markdown document
// (project-markdown.ts): home-agnostic association, a milestone plots at its
// due date or its completion stamp, a task's completion date is its ADR-197
// stamp (updated_at fallback for pre-stamp history). Server-only; bounded at
// 500 rows per collection, one relations query for milestone states.
import { milestoneStates } from "@/lib/milestones";
import { getItem } from "@/lib/items";
import { queryViewItems } from "@/lib/views";

export type TimelineTier = "big" | "small";

export type TimelineEntry = {
  id: string;
  // The item the entry links to (the record itself for "created").
  itemId: string;
  date: Date;
  tier: TimelineTier;
  kind: "meeting" | "milestone" | "task" | "note" | "link" | "created";
  // Short verb phrase for the entry ("Meeting", "Milestone completed", …).
  label: string;
  title: string;
  // Meetings only: the entry has a wall-clock time worth showing.
  hasTime: boolean;
  // True when `date` is a UTC-midnight calendar day (due dates, note dates) —
  // format it in UTC. False for real timestamps (meeting times, completion
  // stamps, created-at), which format in the owner's timezone; rendering a
  // UTC-midnight day in a US timezone would shift it back a day, and rendering
  // a late-evening stamp in UTC would shift it forward one.
  calendarDay: boolean;
  done?: boolean;
  // Link entries only: the outbound URL. The tick's title opens it directly
  // (same rule as the Links card, where the title IS the outbound link).
  url?: string | null;
};

export type ProjectTimeline = {
  entries: TimelineEntry[]; // ascending by date
  // Open milestones with no date to plot — the "Upcoming" tail.
  undated: { id: string; title: string }[];
  // Index of the first entry after now (-1 = none): where the page's Today
  // marker splits past from future. Computed here because a component render
  // must stay pure (no Date.now() in the page).
  firstFutureIndex: number;
};

function taskCompletedAt(properties: unknown, updatedAt: Date): Date {
  const raw = (properties as Record<string, unknown> | null)?.completed_at;
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return updatedAt;
}

type LoadedRecord = Awaited<ReturnType<typeof getItem>>;

export async function gatherProjectTimeline(
  ownerId: string,
  record: LoadedRecord
): Promise<ProjectTimeline> {
  const [meetings, milestones, tasks, notes, links] = await Promise.all([
    queryViewItems(ownerId, { type: "event", relatedTo: record.id }, { field: "meetingAt", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "milestone", relatedTo: record.id }, { field: "dueDate", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "task", relatedTo: record.id }, { field: "createdAt", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "note", relatedTo: record.id }, { field: "createdAt", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "link", relatedTo: record.id }, { field: "createdAt", dir: "asc" }, 500),
  ]);
  const states = await milestoneStates(ownerId, milestones);

  const entries: TimelineEntry[] = [
    {
      id: `created-${record.id}`,
      itemId: record.id,
      date: record.createdAt,
      tier: "big",
      kind: "created",
      label: "Project created",
      title: record.title,
      hasTime: false,
      calendarDay: false,
    },
  ];

  for (const e of meetings) {
    const when = e.meetingAt ?? e.scheduledDate ?? e.dueDate;
    if (!when) continue;
    entries.push({
      id: `meeting-${e.id}`,
      itemId: e.id,
      date: when,
      tier: "big",
      kind: "meeting",
      label: "Meeting",
      title: e.title,
      hasTime: e.meetingAt != null,
      calendarDay: e.meetingAt == null,
    });
  }

  const undated: { id: string; title: string }[] = [];
  for (const m of milestones) {
    const s = states.get(m.id);
    const done = s?.done ?? false;
    const date = done && s?.completedAt ? s.completedAt : m.dueDate;
    if (!date) {
      if (!done) undated.push({ id: m.id, title: m.title });
      continue;
    }
    entries.push({
      id: `milestone-${m.id}`,
      itemId: m.id,
      date,
      tier: "big",
      kind: "milestone",
      label: done ? "Milestone completed" : "Milestone due",
      title: m.title,
      hasTime: false,
      // A completion stamp is a timestamp; a due date is a calendar day.
      calendarDay: !(done && s?.completedAt),
      done,
    });
  }

  for (const t of tasks) {
    if (t.statusCategory !== "done") continue;
    entries.push({
      id: `task-${t.id}`,
      itemId: t.id,
      date: taskCompletedAt(t.properties, t.updatedAt),
      tier: "small",
      kind: "task",
      label: "Task completed",
      title: t.title,
      hasTime: false,
      calendarDay: false,
      done: true,
    });
  }

  for (const n of notes) {
    entries.push({
      id: `note-${n.id}`,
      itemId: n.id,
      date: n.noteDate ?? n.createdAt,
      tier: "small",
      kind: "note",
      label: "Note",
      title: n.title,
      hasTime: false,
      calendarDay: n.noteDate != null,
    });
  }

  for (const l of links) {
    entries.push({
      id: `link-${l.id}`,
      itemId: l.id,
      date: l.createdAt,
      tier: "small",
      kind: "link",
      label: "Link added",
      title: l.title,
      hasTime: false,
      calendarDay: false,
      url: l.url ?? null,
    });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  const now = Date.now();
  return { entries, undated, firstFutureIndex: entries.findIndex((e) => e.date.getTime() > now) };
}
