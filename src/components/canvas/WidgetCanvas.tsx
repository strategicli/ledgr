// The widget-composed canvas (Project Type, redesigned 2026-07-01). A record
// whose type carries the `widget-home` capability renders here instead of
// MarkdownCanvas — that's Project, Pursuit, and every CUSTOM type by default.
//
// The redesigned project homepage has three zones:
//   1. Title.
//   2. A HEADER strip rendered without card chrome or titles: Status as a pill
//      pinned top-right, and a People row + Progress bar stacked on the left.
//   3. A uniform GRID of section cards (Tasks, Milestones, Docs, Meetings by
//      default) — 2-up in the modal, 3-up on the full page — followed by a big
//      "+ Add section" button (the replacement for the old Customize gear).
// Each card carries a quiet "×" to remove it (which returns it to the + menu).
//
// Widgets still come from the shared catalog bound to THIS record (record-
// widgets.ts binds relatedTo to the record; nothing here branches on Type). What
// changed is presentation: a fixed header set vs. cards, uniform card sizing by
// surface variant, and add/remove editing in place instead of via a gear.
import Link from "next/link";
import type { ReactNode } from "react";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import AddSectionButton from "@/components/canvas/AddSectionButton";
import SectionGrid from "@/components/canvas/SectionGrid";
import TasksWidget from "@/components/canvas/widgets/TasksWidget";
import NotesWidget from "@/components/canvas/widgets/NotesWidget";
import LinksWidget from "@/components/canvas/widgets/LinksWidget";
import MilestonesWidget from "@/components/canvas/widgets/MilestonesWidget";
import MeetingsWidget from "@/components/canvas/widgets/MeetingsWidget";
import MindmapWidget from "@/components/canvas/widgets/MindmapWidget";
import ProjectPeople from "@/components/canvas/widgets/ProjectPeople";
import ProjectStatusChip from "@/components/canvas/widgets/ProjectStatusChip";
import type { CanvasProps } from "@/lib/modules";
import { resolveComposition, widgetLimit, type Composition } from "@/lib/composition";
import { progressPct } from "@/lib/project-progress";
import { resolveStatusSchema } from "@/lib/status";
import { availableWidgets } from "@/lib/widgets";
import { resolveRecordWidgets, type RecordWidgetData } from "@/lib/record-widgets";
import { getType } from "@/lib/types";

// Widgets that render in the header strip (no card, no title); everything else
// is a section card.
const HEADER_WIDGETS = new Set(["status", "people", "progress"]);

// Card title overrides — the Notes collection reads as "Docs" on a project
// (Tyler's wording), without renaming the widget everywhere else.
const CARD_TITLE: Record<string, string> = { notes: "Docs" };

// The sections a Project offers on the "+ Add section" menu (Tyler, 2026-07-01):
// the four defaults (so a removed one can return) plus Overview / Recent Activity
// / Timeline / Mindmap, and the header widgets (so a removed Status/People/
// Progress can be re-added). Mindmap is opt-in (added as a block, not a default).
const PROJECT_SECTIONS = new Set([
  "tasks",
  "milestones",
  "notes",
  "meetings",
  "links",
  "mindmap",
  "overview",
  "recentActivity",
  "timeline",
  "status",
  "people",
  "progress",
]);

const CATEGORY_DOT: Record<string, string> = {
  not_started: "bg-neutral-500",
  in_progress: "bg-amber-500",
  done: "bg-green-500",
  archived: "bg-neutral-700",
};

function fmtDay(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function relTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const day = 86_400_000;
  if (diff < day) return "today";
  const days = Math.floor(diff / day);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}

function ItemList({ data }: { data: RecordWidgetData }) {
  const items = data.items ?? [];
  if (items.length === 0) return <EmptyState>Nothing here yet.</EmptyState>;
  // Overflow ("+N more") is handled by the shared CardBody footer as a link into
  // the full collection page, so the list itself just renders its preview rows.
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it) => {
        const day = fmtDay(it.scheduledDate ?? it.dueDate ?? it.meetingAt);
        const done = it.statusCategory === "done";
        return (
          <li key={it.id} className="flex items-center gap-2 text-sm">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT[it.statusCategory] ?? "bg-neutral-600"}`} />
            <Link href={`/items/${it.id}`} className={`truncate hover:text-neutral-200 ${done ? "text-neutral-500 line-through" : "text-neutral-300"}`}>
              {it.title || "Untitled"}
            </Link>
            {day && <span className="ml-auto shrink-0 text-xs text-neutral-500">{day}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// The header progress bar (weighted points; no title, per Tyler's spec).
function HeaderProgress({ data }: { data: RecordWidgetData }) {
  const p = data.progress;
  if (!p) return null;
  const pct = progressPct(p);
  return (
    <div className="flex max-w-2xl flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-neutral-400">
        <span>{pct === null ? "Nothing to track yet" : `${pct}% complete`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

// A card widget that surfaces its own collection page (Tasks/Docs/Meetings/
// Milestones/Links, and Related Records) — the ones the drill-down + count gear
// apply to. People renders in the header, not a card, so it's excluded; so is
// Mindmap (cardinality "one" — a launcher, no "show N"/drill-down).
function isBucketWidget(data: RecordWidgetData): boolean {
  return (
    (Boolean(data.def.recordQuery?.collectionType) && data.def.cardinality === "many") ||
    data.def.id === "relatedRecords"
  );
}

// The card footer for a collection preview: when there are more items than the
// card shows, link into the full collection page (Tyler, 2026-07-01).
function CardOverflowLink({ recordId, defId, shown, total }: { recordId: string; defId: string; shown: number; total: number }) {
  return (
    <Link
      href={`/items/${recordId}/collection/${defId}`}
      className="mt-2 inline-block text-xs text-neutral-500 transition-colors hover:text-neutral-300"
    >
      Showing {shown} of {total} →
    </Link>
  );
}

function CardBody(props: { data: RecordWidgetData; recordId: string; projectTitle: string; body: unknown }) {
  const { data, recordId } = props;
  const shown = data.items?.length ?? 0;
  const total = data.count ?? shown;
  return (
    <>
      <WidgetInner {...props} />
      {isBucketWidget(data) && total > shown && (
        <CardOverflowLink recordId={recordId} defId={data.def.id} shown={shown} total={total} />
      )}
    </>
  );
}

function WidgetInner({
  data,
  recordId,
  projectTitle,
  body,
}: {
  data: RecordWidgetData;
  recordId: string;
  projectTitle: string;
  body: unknown;
}) {
  switch (data.def.id) {
    case "tasks":
      return (
        <TasksWidget
          recordId={recordId}
          projectTitle={projectTitle}
          items={(data.items ?? []).map((i) => ({ id: i.id, title: i.title, statusCategory: i.statusCategory, urgency: i.urgency, recurrence: i.recurrence }))}
        />
      );
    case "notes":
      return (
        <NotesWidget
          recordId={recordId}
          items={(data.items ?? []).map((i) => ({ id: i.id, title: i.title }))}
        />
      );
    case "links":
      return (
        <LinksWidget
          recordId={recordId}
          items={(data.items ?? []).map((i) => ({ id: i.id, title: i.title, url: i.url }))}
        />
      );
    case "milestones":
      return (
        <MilestonesWidget
          recordId={recordId}
          items={(data.items ?? []).map((i) => ({
            id: i.id,
            title: i.title,
            dueDate: i.dueDate ? i.dueDate.toISOString() : null,
          }))}
        />
      );
    case "meetings":
      return (
        <MeetingsWidget
          recordId={recordId}
          items={(data.items ?? []).map((i) => ({
            id: i.id,
            title: i.title,
            when: (i.meetingAt ?? i.scheduledDate ?? i.dueDate)?.toISOString() ?? null,
          }))}
        />
      );
    case "mindmap":
      return (
        <MindmapWidget
          recordId={recordId}
          items={(data.items ?? []).map((i) => ({ id: i.id, title: i.title }))}
        />
      );
    case "overview":
      return (
        <ItemEditor
          item={{ id: recordId, title: "", body: body as never }}
          slot="body"
          collapsibleToolbar
          compactBody
        />
      );
    case "nextAction": {
      // Not on the Project default anymore, but other widget-home types (Pursuit)
      // still carry it as a card.
      const na = data.nextAction;
      if (na?.taskId) {
        return (
          <Link href={`/items/${na.taskId}`} className={`text-sm hover:text-neutral-200 ${na.done ? "text-neutral-500 line-through" : "text-neutral-200"}`}>
            {na.taskTitle || "Untitled task"}
          </Link>
        );
      }
      if (na?.text) return <p className="text-sm text-neutral-200">{na.text}</p>;
      return <EmptyState>No next action set.</EmptyState>;
    }
    case "recentActivity": {
      const ev = data.activity ?? [];
      if (ev.length === 0) return <EmptyState>No activity yet.</EmptyState>;
      return (
        <ul className="flex flex-col gap-1.5">
          {ev.slice(0, 12).map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 text-sm">
              <span className="truncate text-neutral-300">{e.summary}</span>
              <span className="ml-auto shrink-0 text-xs text-neutral-500">{relTime(e.occurredAt)}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "timeline": {
      const entries = data.timeline ?? [];
      if (entries.length === 0) return <EmptyState>No meetings or milestones yet.</EmptyState>;
      return (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => (
            <li key={`${e.kind}-${e.id}`} className="flex items-center gap-2 text-sm">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${e.kind === "milestone" ? "bg-amber-950/50 text-amber-300" : "bg-sky-950/50 text-sky-300"}`}>
                {e.kind}
              </span>
              <Link href={`/items/${e.id}`} className="min-w-0 flex-1 truncate text-neutral-200 hover:text-neutral-100">
                {e.title || "Untitled"}
              </Link>
              <span className="shrink-0 text-xs text-neutral-500">{fmtDay(e.date)}</span>
            </li>
          ))}
        </ul>
      );
    }
    default:
      // collection + relation widgets (meetings, links, relatedRecords, …)
      return <ItemList data={data} />;
  }
}

// The "+ Add section" menu contents: catalog sections not already present. For a
// Project we curate the list (PROJECT_SECTIONS); other widget-home types get the
// whole catalog.
function addableSections(type: string, comp: Composition): { id: string; label: string }[] {
  const present = new Set(comp.widgets.map((w) => w.defId));
  return availableWidgets(type)
    .filter((w) => (type === "project" ? PROJECT_SECTIONS.has(w.id) : true))
    .filter((w) => !present.has(w.id))
    .map((w) => ({ id: w.id, label: CARD_TITLE[w.id] ?? w.label }));
}

export default async function WidgetCanvas({ item, ownerId, variant }: CanvasProps) {
  const typeDef = await getType(item.type).catch(() => null);
  const { composition } = resolveComposition(item.composition, typeDef?.defaultWidgets, item.type);
  const widgets = await resolveRecordWidgets(ownerId, item, composition);

  // Render order = composition array order (header widgets are pulled out by id).
  const headerWidgets = widgets.filter((d) => HEADER_WIDGETS.has(d.def.id));
  const cardWidgets = widgets.filter((d) => !HEADER_WIDGETS.has(d.def.id));

  const statusData = headerWidgets.find((d) => d.def.id === "status");
  const peopleData = headerWidgets.find((d) => d.def.id === "people");
  const progressData = headerWidgets.find((d) => d.def.id === "progress");

  const statuses = resolveStatusSchema(typeDef?.statusSchema ?? null);
  const statusMode = typeDef?.statusMode ?? "checkbox";
  const showStatus = Boolean(statusData) && statusMode !== "none" && statuses.length > 0;

  const hasHeader = showStatus || Boolean(peopleData) || Boolean(progressData);
  const addable = addableSections(item.type, composition);

  return (
    // Same container as the breadcrumb row + the other canvases (max-w-3xl,
    // widened to ~5xl by .canvas-wide on the full page) so the header/title and
    // cards line up exactly with the "Trash · Project · ⋯" row above (Tyler).
    <div className="mx-auto w-full max-w-3xl px-2 pb-24 pt-4 sm:px-8 md:px-12">
      <div className="mb-3 min-w-0">
        <ItemEditor item={{ id: item.id, title: item.title, body: item.body }} slot="title" />
      </div>

      {hasHeader && (
        // Progress on top spanning the header (Tyler, 2026-07-01), then People on
        // the left and the Status pill on the right beneath it.
        <div className="mb-5 flex flex-col gap-3">
          {progressData && <HeaderProgress data={progressData} />}
          {(peopleData || showStatus) && (
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                {peopleData && (
                  <ProjectPeople
                    recordId={item.id}
                    people={(peopleData.items ?? []).map((p) => ({ id: p.id, title: p.title }))}
                  />
                )}
              </div>
              {showStatus && (
                <div className="shrink-0">
                  <ProjectStatusChip itemId={item.id} statuses={statuses} initial={item.status} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {cardWidgets.length === 0 ? (
        <EmptyState>No sections yet. Use “Add section” below to add one.</EmptyState>
      ) : (
        <SectionGrid
          itemId={item.id}
          composition={composition}
          variant={variant}
          items={cardWidgets.map((data) => ({
            instanceId: data.instance.instanceId,
            title: CARD_TITLE[data.def.id] ?? data.def.label,
            body: <CardBody data={data} recordId={item.id} projectTitle={item.title} body={item.body} />,
            // Collection/related cards get the hover "show N" gear (default 5);
            // Overview / Status / derived single-value cards don't.
            countLimit: isBucketWidget(data) ? widgetLimit(data.instance) : undefined,
          }))}
        />
      )}

      <AddSectionButton itemId={item.id} composition={composition} addable={addable} />
    </div>
  );
}
