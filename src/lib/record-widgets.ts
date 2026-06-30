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

type ProgressData = { done: number; total: number; fraction: number | null };

// A record's OWN task progress (PRD §6 hierarchical, or flat). Extracted so a
// Pursuit can roll up its projects' progress (PJ9).
async function taskProgress(
  ownerId: string,
  recordId: string,
  weighting: string
): Promise<ProgressData> {
  const tops = await queryViewItems(
    ownerId,
    { type: "task", relatedTo: recordId, relatedHome: true },
    { field: "createdAt", dir: "asc" },
    500
  );
  const total = tops.length;
  if (total === 0) return { done: 0, total: 0, fraction: null };
  const done = tops.filter((t) => t.statusCategory === "done").length;
  if (weighting === "flat") return { done, total, fraction: done / total };
  const DEEP = 200;
  const fractions = await Promise.all(
    tops.map(async (t, i) => {
      if (i >= DEEP) return t.statusCategory === "done" ? 1 : 0;
      const sub = await listSubtree(ownerId, t.id).catch(() => null);
      return rootFraction(t.statusCategory, sub?.children ?? []);
    })
  );
  return { done, total, fraction: fractions.reduce((a, b) => a + b, 0) / fractions.length };
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
  };
}

// The bound filter for a collection/relation widget: items related to this
// record. Contained collections (role "project"/"contains") are home-scoped
// (what LIVES here); people/related are direction-blind associations.
function boundFilter(def: WidgetDefinition, recordId: string): ViewFilter | null {
  const q = def.recordQuery;
  if (!q) return null;
  const home = q.role !== undefined && q.role !== "related";
  const filter: ViewFilter = { relatedTo: recordId };
  if (q.collectionType) filter.type = q.collectionType;
  if (q.role) filter.relatedRole = q.role;
  if (home) filter.relatedHome = true;
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
    const weighting = (instance.options?.weighting as string) ?? "hierarchical";
    // Roll-up (PJ9): a record that contains projects (a Pursuit) shows the
    // average of its projects' fractions — done = # projects fully complete,
    // total = # projects. Otherwise the record's own task progress (PRD §6).
    const projects = await containedProjects(ownerId, record.id);
    if (projects.length > 0) {
      const child = await Promise.all(projects.map((p) => taskProgress(ownerId, p.id, weighting)));
      const fracs = child.map((c) => c.fraction).filter((f): f is number => f !== null);
      const done = child.filter((c) => c.fraction === 1).length;
      return {
        ...base,
        progress: { done, total: projects.length, fraction: fracs.length ? fracs.reduce((a, b) => a + b, 0) / fracs.length : null },
      };
    }
    return { ...base, progress: await taskProgress(ownerId, record.id, weighting) };
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
