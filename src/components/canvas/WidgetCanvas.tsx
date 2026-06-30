// The widget-composed canvas (Project Type, ADR-111/PJ4). A record whose type
// carries the `widget-home` capability (Project, and any type via PJ10) renders
// here instead of MarkdownCanvas: a title + a set of widgets bound to THIS
// record, composed from the type default (Layer 2) overlaid by the record's own
// composition (Layer 3). The same widget catalog runs here (record scope) and on
// a Dashboard (query scope) — the fan-out (record-widgets.ts) binds relatedTo to
// the record; nothing here branches on the record's Type.
//
// PJ4 ships the shell + the read/compose surface + the "Customize" gear
// (enable/disable = hide-not-delete, reset). Editable Tasks/Notes (PJ5), the
// richer derived lenses (PJ6), and drag-arrange persistence are follow-ups; for
// now widgets render in their saved/default grid positions.
import Link from "next/link";
import type { ReactNode } from "react";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import WidgetGear from "@/components/canvas/WidgetGear";
import TasksWidget from "@/components/canvas/widgets/TasksWidget";
import NotesWidget from "@/components/canvas/widgets/NotesWidget";
import MilestonesWidget from "@/components/canvas/widgets/MilestonesWidget";
import type { CanvasProps } from "@/lib/modules";
import { resolveComposition } from "@/lib/composition";
import { availableWidgets } from "@/lib/widgets";
import { resolveRecordWidgets, type RecordWidgetData } from "@/lib/record-widgets";
import { getType } from "@/lib/types";

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
  const more = (data.count ?? items.length) - items.length;
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
      {more > 0 && <li className="text-xs text-neutral-500">+{more} more</li>}
    </ul>
  );
}

function WidgetBody({
  data,
  recordId,
  body,
  nextActionTaskId,
}: {
  data: RecordWidgetData;
  recordId: string;
  body: unknown;
  nextActionTaskId: string | null;
}) {
  switch (data.def.id) {
    case "tasks":
      return (
        <TasksWidget
          recordId={recordId}
          nextActionTaskId={nextActionTaskId}
          items={(data.items ?? []).map((i) => ({ id: i.id, title: i.title, statusCategory: i.statusCategory }))}
        />
      );
    case "notes":
      return (
        <NotesWidget
          recordId={recordId}
          items={(data.items ?? []).map((i) => ({ id: i.id, title: i.title }))}
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
    case "overview":
      return (
        <ItemEditor
          item={{ id: recordId, title: "", body: body as never }}
          slot="body"
          collapsibleToolbar
          compactBody
        />
      );
    case "status":
      return (
        <span className="inline-flex items-center gap-2 text-sm text-neutral-300">
          <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[data.status?.category ?? "not_started"]}`} />
          {data.status?.key ?? "—"}
        </span>
      );
    case "nextAction": {
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
    case "progress": {
      const p = data.progress;
      if (!p || p.fraction === null) return <EmptyState>No tasks yet.</EmptyState>;
      const pct = Math.round(p.fraction * 100);
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>{p.done}/{p.total} done</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-green-600" style={{ width: `${pct}%` }} />
          </div>
          {pct === 100 && <p className="text-xs text-neutral-500">All tasks done — mark this project done?</p>}
        </div>
      );
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
    case "timeline":
      return <EmptyState>Timeline arrives with PJ6/PJ11.</EmptyState>;
    default:
      // collection + relation + people widgets
      return <ItemList data={data} />;
  }
}

export default async function WidgetCanvas({ item, ownerId }: CanvasProps) {
  const typeDef = await getType(item.type).catch(() => null);
  const { composition } = resolveComposition(item.composition, typeDef?.defaultWidgets, item.type);
  const widgets = await resolveRecordWidgets(ownerId, item, composition);

  // Sort by saved lg position (row then column) so the §8 default reads right;
  // each card spans its lg width on a 12-col grid (collapses to 1 col on mobile).
  const ordered = [...widgets].sort((a, b) => {
    const la = a.instance.layout?.lg;
    const lb = b.instance.layout?.lg;
    return (la?.y ?? 0) - (lb?.y ?? 0) || (la?.x ?? 0) - (lb?.x ?? 0);
  });

  const catalog = availableWidgets(item.type).map((w) => ({ id: w.id, label: w.label }));

  return (
    <div className="mx-auto w-full max-w-6xl px-2 pb-24 pt-4 sm:px-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <ItemEditor item={{ id: item.id, title: item.title, body: item.body }} slot="title" />
        </div>
        <WidgetGear itemId={item.id} composition={composition} catalog={catalog} />
      </div>

      {ordered.length === 0 ? (
        <EmptyState>No widgets enabled. Use Customize to add some.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          {ordered.map((data) => {
            const w = Math.min(Math.max(data.instance.layout?.lg?.w ?? 12, 1), 12);
            return (
              <section
                key={data.instance.instanceId}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
                style={{ gridColumn: `span ${w} / span ${w}` }}
                data-md-span={w}
              >
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {data.def.label}
                </h3>
                <WidgetBody data={data} recordId={item.id} body={item.body} nextActionTaskId={item.nextActionTaskId ?? null} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
