// The record-scope widget fan-out (Project Type, ADR-111/PJ4): given a record +
// its resolved composition, produce the data each visible widget needs, bound to
// the record. This is DashboardView's per-widget fan-out generalized to a record
// scope — every collection/relation widget binds `relatedTo = record.id` (home-
// scoped for contained collections), and derived/property widgets read the base
// + the log. Server-only (queries the DB); the canvas renders what this returns,
// with no widget-side branching on the record's Type.
import { listActivity } from "@/lib/activity";
import type { Composition, RecordWidget } from "@/lib/composition";
import { getItem } from "@/lib/items";
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
};

type LoadedRecord = Awaited<ReturnType<typeof getItem>>;

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
    let taskTitle: string | null = null;
    let done = false;
    if (record.nextActionTaskId) {
      const t = await getItem(ownerId, record.nextActionTaskId).catch(() => null);
      taskTitle = t?.title ?? null;
      done = t?.statusCategory === "done";
    }
    return {
      ...base,
      nextAction: {
        text: record.nextActionText ?? null,
        taskId: record.nextActionTaskId ?? null,
        taskTitle,
        done,
      },
    };
  }
  if (def.id === "progress") {
    // Flat over the contained (home) tasks for PJ4 — hierarchical, subtask-aware
    // weighting lands in PJ6. Zero tasks → indeterminate (null), never 0%.
    const tasks = await queryViewItems(
      ownerId,
      { type: "task", relatedTo: record.id, relatedHome: true },
      { field: "updatedAt", dir: "desc" },
      500
    );
    const total = tasks.length;
    const done = tasks.filter((t) => t.statusCategory === "done").length;
    return { ...base, progress: { done, total, fraction: total === 0 ? null : done / total } };
  }
  if (def.id === "recentActivity") {
    const events = await listActivity(ownerId, record.id, ACTIVITY_LIMIT);
    return {
      ...base,
      activity: events.map((e) => ({ id: e.id, kind: e.kind, summary: e.summary, occurredAt: e.occurredAt })),
    };
  }

  // relatedRecords: every contained record (home), any type.
  if (def.id === "relatedRecords") {
    const related = await listRelatedItems(ownerId, record.id).catch(() => []);
    const home = related.filter((r) => (r as { home?: boolean }).home);
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
