// The record-scope widget fan-out (Project Type, ADR-111/PJ4): given a record +
// its resolved composition, produce the data each visible widget needs, bound to
// the record. This is DashboardView's per-widget fan-out generalized to a record
// scope — every collection/relation widget binds `relatedTo = record.id` (home-
// scoped for contained collections), and derived/property widgets read the base
// + the log. Server-only (queries the DB); the canvas renders what this returns,
// with no widget-side branching on the record's Type.
import { listActivity, listActivityForSubjects } from "@/lib/activity";
import type { Composition, RecordWidget } from "@/lib/composition";
import { getItem } from "@/lib/items";
import { describeRule, parseRecurrence } from "@/lib/recurrence";
import {
  combineProgress,
  meetingPoints,
  milestonePoints,
  taskPoints,
  type PointProgress,
} from "@/lib/project-progress";
import { listSubtree, type SubtaskNode } from "@/lib/subtasks";
import { listRelatedItems } from "@/lib/relations";
import { widgetById, type WidgetDefinition } from "@/lib/widgets";
import { countViewItems, queryViewItems, type ViewFilter } from "@/lib/views";

const COLLECTION_LIMIT = 50;
const ACTIVITY_LIMIT = 30;

export type WidgetItemRow = {
  id: string;
  type: string;
  title: string;
  status: string;
  statusCategory: string;
  dueDate: Date | null;
  scheduledDate: Date | null;
  urgency: number | null;
  meetingAt: Date | null;
  // The item's URL (link type) — so a Links widget row can make the title itself
  // the outbound link. Null for non-link items.
  url: string | null;
  // A human recurrence label (e.g. "Weekly on Mon") when the item repeats, else
  // null. Surfaced so a task row can show its recurrence inline with the title.
  recurrence: string | null;
};

export type RecordWidgetData = {
  instance: RecordWidget;
  def: WidgetDefinition;
  // collection / relation widgets
  items?: WidgetItemRow[];
  count?: number;
  // overview (markdown body is read from the item directly by the canvas)
  // status
  status?: { key: string; category: string };
  // nextAction
  nextAction?: { text: string | null; taskId: string | null; taskTitle: string | null; done: boolean };
  // progress (fraction null = indeterminate "no tasks yet")
  progress?: { done: number; total: number; fraction: number | null };
  // recentActivity
  activity?: { id: string; kind: string; summary: string; occurredAt: Date }[];
  // timeline (meetings + milestones overlaid by date, read-only)
  timeline?: { id: string; title: string; kind: "meeting" | "milestone"; date: Date }[];
};

type LoadedRecord = Awaited<ReturnType<typeof getItem>>;

// Recursive completion fraction over a subtask node (PRD §6): a leaf task is
// 0/1; a parent's fraction is the average of its task-children's fractions. Only
// task-type children count — a note/meeting filed under a task is context.
function nodeFraction(node: SubtaskNode): number {
  const taskKids = node.children.filter((c) => c.type === "task");
  if (taskKids.length === 0) return node.statusCategory === "done" ? 1 : 0;
  return taskKids.reduce((a, c) => a + nodeFraction(c), 0) / taskKids.length;
}

// A top-level contained task's fraction: its own done-state if it has no task
// subtasks, else the average of those subtasks' fractions.
function rootFraction(rootCategory: string, children: SubtaskNode[]): number {
  const taskKids = children.filter((c) => c.type === "task");
  if (taskKids.length === 0) return rootCategory === "done" ? 1 : 0;
  return taskKids.reduce((a, c) => a + nodeFraction(c), 0) / taskKids.length;
}

// A record's OWN weighted-points progress (Tyler, 2026-07-01): tasks (worth more
// with subtasks, partial credit by subtree completion), milestones (complete
// once their date has passed), and meetings (complete once in the past), summed
// into completed-points ÷ total-points (src/lib/project-progress.ts). Extracted
// so a Pursuit can roll up its projects' progress (PJ9). `done`/`total` are
// POINTS here, not item counts.
function todayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function recordPointProgress(ownerId: string, recordId: string): Promise<PointProgress> {
  const [tasks, milestones, meetings] = await Promise.all([
    // Count everything associated with the record (any relation), matching what
    // the Tasks / Milestones / Meetings boxes show (boundFilter).
    queryViewItems(ownerId, { type: "task", relatedTo: recordId }, { field: "createdAt", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "milestone", relatedTo: recordId }, { field: "dueDate", dir: "asc" }, 500),
    queryViewItems(ownerId, { type: "event", relatedTo: recordId }, { field: "meetingAt", dir: "asc" }, 500),
  ]);
  const now = Date.now();
  const today = todayUtcMs();
  const DEEP = 200; // beyond this, treat a task as a leaf (no subtree probe) — bound the fan-out.
  const taskParts = await Promise.all(
    tasks.map(async (t, i) => {
      if (i >= DEEP) return taskPoints(t.statusCategory === "done" ? 1 : 0, 0);
      const sub = await listSubtree(ownerId, t.id).catch(() => null);
      const kids = sub?.children ?? [];
      const subtaskCount = kids.filter((c) => c.type === "task").length;
      return taskPoints(rootFraction(t.statusCategory, kids), subtaskCount);
    })
  );
  const msParts = milestones.map((m) => milestonePoints(m.dueDate ? m.dueDate.getTime() < today : false));
  const mtParts = meetings.map((e) => {
    const when = e.meetingAt ?? e.scheduledDate ?? e.dueDate;
    return meetingPoints(when ? when.getTime() < now : false);
  });
  return combineProgress([...taskParts, ...msParts, ...mtParts]);
}

// The tracked container records this record CONTAINS (home edges) — a Pursuit's
// Projects. Drives the derived roll-ups (PJ9). A plain project contains tasks,
// not projects, so this is empty for it (no roll-up; its own progress is used).
async function containedProjects(ownerId: string, recordId: string) {
  return queryViewItems(
    ownerId,
    { type: "project", relatedTo: recordId, relatedHome: true },
    { field: "createdAt", dir: "asc" },
    200
  );
}

function recurrenceLabel(properties: unknown): string | null {
  const rule = parseRecurrence((properties as Record<string, unknown> | null)?.recurrence);
  return rule ? describeRule(rule) : null;
}

function row(i: Awaited<ReturnType<typeof queryViewItems>>[number]): WidgetItemRow {
  return {
    id: i.id,
    type: i.type,
    title: i.title,
    status: i.status,
    statusCategory: i.statusCategory,
    dueDate: i.dueDate,
    scheduledDate: i.scheduledDate,
    urgency: i.urgency,
    meetingAt: i.meetingAt,
    url: i.url ?? null,
    recurrence: recurrenceLabel(i.properties),
  };
}

// The bound filter for a collection/relation widget: items related to this
// record. Contained collections (role "project"/"contains") are home-scoped
// (what LIVES here); people/related are direction-blind associations.
function boundFilter(def: WidgetDefinition, recordId: string): ViewFilter | null {
  const q = def.recordQuery;
  if (!q) return null;
  const filter: ViewFilter = { relatedTo: recordId };
  // A typed collection box (Tasks, Docs, Meetings, Milestones, Links, People)
  // shows every item of that type ASSOCIATED with this record, however it was
  // linked — role- and home-agnostic (Tyler, 2026-07-01: "the box should pull
  // anything of that type that is associated with the project"). A link related
  // from the Links page, a task assigned via the field/picker, a note contained
  // via the record — all count. relatedTo matches confirmed edges in either
  // direction, so this is exactly "of this type AND connected to this record".
  if (q.collectionType) {
    filter.type = q.collectionType;
    return filter;
  }
  // The generic contained-records box (relatedRecords / a Pursuit's projects)
  // keeps home/role scoping — what LIVES here, not just anything related.
  if (q.role) filter.relatedRole = q.role;
  if (q.role && q.role !== "related") filter.relatedHome = true;
  return filter;
}

async function dataForWidget(
  ownerId: string,
  record: LoadedRecord,
  instance: RecordWidget,
  def: WidgetDefinition
): Promise<RecordWidgetData> {
  const base: RecordWidgetData = { instance, def };

  // Property widgets read the record base.
  if (def.id === "status") {
    return { ...base, status: { key: record.status, category: record.statusCategory } };
  }
  if (def.id === "overview") return base; // canvas reads record.body directly

  // Derived widgets.
  if (def.id === "nextAction") {
    // Own pinned Next Action, else roll up: the single next step across the
    // contained projects (the first project that has one) — PJ9.
    if (record.nextActionTaskId || record.nextActionText) {
      let taskTitle: string | null = null;
      let done = false;
      if (record.nextActionTaskId) {
        const t = await getItem(ownerId, record.nextActionTaskId).catch(() => null);
        taskTitle = t?.title ?? null;
        done = t?.statusCategory === "done";
      }
      return {
        ...base,
        nextAction: { text: record.nextActionText ?? null, taskId: record.nextActionTaskId ?? null, taskTitle, done },
      };
    }
    const projects = await containedProjects(ownerId, record.id);
    for (const p of projects) {
      const proj = await getItem(ownerId, p.id).catch(() => null);
      if (proj?.nextActionTaskId || proj?.nextActionText) {
        let taskTitle: string | null = null;
        if (proj.nextActionTaskId) {
          const t = await getItem(ownerId, proj.nextActionTaskId).catch(() => null);
          taskTitle = t?.title ?? null;
        }
        return {
          ...base,
          nextAction: { text: proj.nextActionText ?? null, taskId: proj.nextActionTaskId ?? null, taskTitle, done: false },
        };
      }
    }
    return { ...base, nextAction: { text: null, taskId: null, taskTitle: null, done: false } };
  }
  if (def.id === "progress") {
    // Roll-up (PJ9): a record that contains projects (a Pursuit) shows the
    // average of its projects' fractions — done = # projects fully complete,
    // total = # projects. Otherwise the record's own weighted-points progress.
    const projects = await containedProjects(ownerId, record.id);
    if (projects.length > 0) {
      const child = await Promise.all(projects.map((p) => recordPointProgress(ownerId, p.id)));
      const fracs = child.map((c) => c.fraction).filter((f): f is number => f !== null);
      const done = child.filter((c) => c.fraction === 1).length;
      return {
        ...base,
        progress: { done, total: projects.length, fraction: fracs.length ? fracs.reduce((a, b) => a + b, 0) / fracs.length : null },
      };
    }
    return { ...base, progress: await recordPointProgress(ownerId, record.id) };
  }
  if (def.id === "recentActivity") {
    // Roll-up (PJ9): a Pursuit's timeline is the union of its own + its projects'
    // logs. A plain record just reads its own (subjects = [itself]).
    const projects = await containedProjects(ownerId, record.id);
    const subjects = [record.id, ...projects.map((p) => p.id)];
    const events =
      subjects.length === 1
        ? await listActivity(ownerId, record.id, ACTIVITY_LIMIT)
        : await listActivityForSubjects(ownerId, subjects, ACTIVITY_LIMIT);
    return {
      ...base,
      activity: events.map((e) => ({ id: e.id, kind: e.kind, summary: e.summary, occurredAt: e.occurredAt })),
    };
  }

  // relatedRecords: every contained record (home), any type.
  if (def.id === "relatedRecords") {
    const related = await listRelatedItems(ownerId, record.id).catch(() => []);
    const typeFilter = (instance.options?.typeFilter as string | null | undefined) ?? null;
    const home = related
      .filter((r) => (r as { home?: boolean }).home)
      .filter((r) => (typeFilter ? r.type === typeFilter : true));
    return {
      ...base,
      items: home.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        status: r.status,
        statusCategory: r.statusCategory,
        dueDate: r.dueDate,
        scheduledDate: r.scheduledDate,
        urgency: r.urgency,
        meetingAt: r.meetingAt,
        url: (r as { url?: string | null }).url ?? null,
        recurrence: null,
      })),
      count: home.length,
    };
  }

  if (def.id === "timeline") {
    // Read-only overlay of the record's Meetings + Milestones by date (PRD §6) —
    // the two collections shown together without merging their data.
    const [events, milestones] = await Promise.all([
      queryViewItems(ownerId, { type: "event", relatedTo: record.id, relatedHome: true }, { field: "meetingAt", dir: "asc" }, 50),
      queryViewItems(ownerId, { type: "milestone", relatedTo: record.id, relatedHome: true }, { field: "dueDate", dir: "asc" }, 50),
    ]);
    const entries = [
      ...events.map((e) => ({ id: e.id, title: e.title, kind: "meeting" as const, date: e.meetingAt ?? e.scheduledDate ?? e.dueDate })),
      ...milestones.map((m) => ({ id: m.id, title: m.title, kind: "milestone" as const, date: m.dueDate })),
    ]
      .filter((x): x is { id: string; title: string; kind: "meeting" | "milestone"; date: Date } => x.date != null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    return { ...base, timeline: entries };
  }

  // Collection + people widgets: a bound query.
  const filter = boundFilter(def, record.id);
  if (filter) {
    const [rows, count] = await Promise.all([
      queryViewItems(ownerId, filter, { field: "updatedAt", dir: "desc" }, COLLECTION_LIMIT),
      countViewItems(ownerId, filter),
    ]);
    return { ...base, items: rows.map(row), count };
  }

  // timeline + any unmapped derived: leave for PJ6/PJ11; render an empty state.
  return base;
}

// Resolve the data for every VISIBLE widget in the composition, in order.
// Hidden widgets (Layer-3 disabled) are skipped — their backing items are
// untouched, so re-enabling restores them.
export async function resolveRecordWidgets(
  ownerId: string,
  record: LoadedRecord,
  composition: Composition
): Promise<RecordWidgetData[]> {
  const visible = composition.widgets.filter((iw) => !iw.hidden);
  return Promise.all(
    visible.map((instance) => {
      const def = widgetById(instance.defId);
      if (!def) return Promise.resolve(null);
      return dataForWidget(ownerId, record, instance, def);
    })
  ).then((arr) => arr.filter((x): x is RecordWidgetData => x !== null));
}
