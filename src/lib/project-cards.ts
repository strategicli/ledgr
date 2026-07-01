// Card data for the all-projects grid (Tyler, 2026-07-01): given the project
// rows already queried by the list page, produce each card's status, progress,
// people, and collection counts. Server-only.
//
// Progress here is a *flat* pass of the weighted-points model — tasks count as
// done/not-done without the per-task subtree probe the record canvas does — so a
// grid of many projects stays cheap (a card is a glance; the open project shows
// the precise bar). Perf note: this runs ~4 bounded queries per project; if the
// project count grows large, batch these into grouped queries (see next_steps).
import {
  combineProgress,
  meetingPoints,
  milestonePoints,
  taskPoints,
  type PointProgress,
} from "@/lib/project-progress";
import { statusSchemaForType } from "@/lib/status-schema";
import { queryViewItems } from "@/lib/views";

export type ProjectCard = {
  id: string;
  title: string;
  status: { label: string; color: string; category: string } | null;
  progress: PointProgress;
  people: { id: string; title: string }[];
  counts: { tasks: number; milestones: number; meetings: number };
};

type ProjectRow = { id: string; title: string; status: string; statusCategory: string };

function todayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function cardData(
  ownerId: string,
  project: ProjectRow,
  statusColor: (key: string) => { label: string; color: string; category: string } | null
): Promise<ProjectCard> {
  const [tasks, milestones, meetings, people] = await Promise.all([
    // Everything associated with the project (any relation) — matches the canvas
    // boxes (boundFilter): all tasks/milestones/meetings/people connected to it.
    queryViewItems(ownerId, { type: "task", relatedTo: project.id }, { field: "createdAt", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "milestone", relatedTo: project.id }, { field: "dueDate", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "event", relatedTo: project.id }, { field: "meetingAt", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "person", relatedTo: project.id }, { field: "updatedAt", dir: "desc" }, 12),
  ]);
  const now = Date.now();
  const today = todayUtcMs();
  const progress = combineProgress([
    ...tasks.map((t) => taskPoints(t.statusCategory === "done" ? 1 : 0, 0)),
    ...milestones.map((m) => milestonePoints(m.dueDate ? m.dueDate.getTime() < today : false)),
    ...meetings.map((e) => {
      const when = e.meetingAt ?? e.scheduledDate ?? e.dueDate;
      return meetingPoints(when ? when.getTime() < now : false);
    }),
  ]);
  return {
    id: project.id,
    title: project.title,
    status: statusColor(project.status),
    progress,
    people: people.map((p) => ({ id: p.id, title: p.title })),
    counts: { tasks: tasks.length, milestones: milestones.length, meetings: meetings.length },
  };
}

export async function listProjectCardData(ownerId: string, projects: ProjectRow[]): Promise<ProjectCard[]> {
  const schema = await statusSchemaForType("project");
  const statusColor = (key: string) => {
    const def = schema.find((s) => s.key === key);
    return def ? { label: def.label, color: def.color, category: def.category } : null;
  };
  return Promise.all(projects.map((p) => cardData(ownerId, p, statusColor)));
}
