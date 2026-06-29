// Tasks — a Todoist-style four-tab surface (Tasks redesign): Today · Inbox ·
// Upcoming · Projects. Today groups by priority (P1–P6 colors); Inbox is the
// untriaged bucket; Upcoming is a day-grouped, week-paged list (← Current → +1
// week…); Projects shows each project with its open tasks. The tab + week are
// URL params (?tab=, ?week=), so it's all server-rendered. (The richer capture
// card + per-day add, and the bespoke task canvas, are later slices.)
import Link from "next/link";
import { redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import ViewRenderer from "@/components/views/ViewRenderer";
import NewItemButton from "@/components/home/NewItemButton";
import InlineAddTask from "@/components/tasks/InlineAddTask";
import RowAction from "@/components/home/RowAction";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import { bulkConfigForType } from "@/lib/bulk-config";
import { priorityStyle, prioritySortKey, type Priority } from "@/lib/priority";
import { resolveOwner } from "@/lib/owner";
import { resolveStatusSchema, type StatusDef } from "@/lib/status";
import { todayBounds } from "@/lib/today";
import { getType } from "@/lib/types";
import { queryViewItems, type ViewDefinition } from "@/lib/views";

export const dynamic = "force-dynamic";

type ListedItem = Awaited<ReturnType<typeof queryViewItems>>[number];
type Tab = "today" | "inbox" | "upcoming" | "projects" | "planner";
const TABS: { key: Tab; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "inbox", label: "Inbox" },
  { key: "upcoming", label: "Upcoming" },
  { key: "projects", label: "Projects" },
  { key: "planner", label: "Planner" },
];

const DAY_MS = 86400000;
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
// The date that places a task: its effective plan date — scheduled (planned)
// day if set, else the due deadline (ADR-109). Scheduled-primary, due-secondary,
// and undated when neither is set.
function effDate(t: ListedItem): Date | null {
  return t.scheduledDate ?? t.dueDate ?? null;
}

function TaskRow({ task, dueToday, statuses }: { task: ListedItem; dueToday: Date; statuses: StatusDef[] }) {
  const done = task.statusCategory === "done";
  const sdef = statuses.find((s) => s.key === task.status);
  const date = effDate(task);
  const overdue = !done && date != null && date < dueToday;
  const pri = task.urgency != null ? (task.urgency as Priority) : null;
  return (
    <li className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60">
      <SelectCheckbox id={task.id} />
      <SubtaskCheckbox id={task.id} done={done} />
      <Link
        href={`/items/${task.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${task.title ? "text-neutral-200" : "text-neutral-500"} ${done ? "line-through opacity-60" : ""}`}
      >
        {task.title || "Untitled"}
      </Link>
      {pri != null && pri <= 5 && (
        <span className={`shrink-0 rounded border px-1.5 text-xs ${priorityStyle(pri).text} ${priorityStyle(pri).border}`}>
          P{pri}
        </span>
      )}
      {sdef && sdef.category !== "not_started" && (
        <span className="hidden shrink-0 items-center gap-1 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400 sm:inline-flex">
          {sdef.color && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: sdef.color }} />}
          {sdef.label}
        </span>
      )}
      <span className={`shrink-0 text-xs ${overdue ? "text-red-400" : "text-neutral-600"}`}>
        {date ? dayFmt.format(date) : ""}
      </span>
      <RowAction id={task.id} action="trash" />
    </li>
  );
}

function TaskList({ tasks, dueToday, statuses }: { tasks: ListedItem[]; dueToday: Date; statuses: StatusDef[] }) {
  return (
    <ul className="mt-1">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} dueToday={dueToday} statuses={statuses} />
      ))}
    </ul>
  );
}

export default async function Tasks({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "today") as Tab;
  const weekOffset = Math.max(0, Number.parseInt(typeof sp.week === "string" ? sp.week : "0", 10) || 0);

  const taskType = await getType("task");
  const statuses = resolveStatusSchema(taskType.statusSchema);
  const { dueToday } = todayBounds();

  const tabStrip = (
    <div className="mt-4 flex gap-1 border-b border-neutral-800">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/tasks?tab=${t.key}`}
          className={`rounded-t px-3 py-1.5 text-sm ${
            tab === t.key ? "border-b-2 border-[var(--accent)] text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );

  let body: React.ReactNode = null;
  // The selectable task ids on the active tab, in display order (powers the
  // multi-select range + select-all). Project headers and inline-add rows aren't
  // selectable; only task rows are.
  let selectableIds: string[] = [];

  if (tab === "today") {
    const active = await queryViewItems(owner.id, { type: "task", statusCategory: "active" }, { field: "plan", dir: "asc" });
    const today = active.filter((t) => {
      const d = effDate(t);
      return d != null && d <= dueToday;
    });
    // group by priority (1..6; null → 6/none)
    const groups = new Map<number, ListedItem[]>();
    for (const t of today) {
      const k = prioritySortKey(t.urgency != null ? (t.urgency as Priority) : null);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
    selectableIds = ordered.flatMap(([, items]) => items.map((t) => t.id));
    body =
      today.length === 0 ? (
        <p className="mt-6 px-2 text-sm text-neutral-600">Nothing due today. 🎉</p>
      ) : (
        <div className="mt-4 space-y-4">
          {ordered.map(([k, items]) => {
            const s = priorityStyle(k as Priority);
            return (
              <div key={k}>
                <h3 className={`px-2 text-xs font-semibold uppercase tracking-wide ${s.text}`}>
                  {k === 6 ? "No priority" : `Priority ${k}`}
                </h3>
                <TaskList tasks={items} dueToday={dueToday} statuses={statuses} />
              </div>
            );
          })}
        </div>
      );
  } else if (tab === "inbox") {
    const inbox = await queryViewItems(owner.id, { type: "task", inbox: true, statusCategory: "active" }, { field: "createdAt", dir: "desc" });
    selectableIds = inbox.map((t) => t.id);
    body =
      inbox.length === 0 ? (
        <p className="mt-6 px-2 text-sm text-neutral-600">Inbox zero. Quick-capture lands here for triage.</p>
      ) : (
        <TaskList tasks={inbox} dueToday={dueToday} statuses={statuses} />
      );
  } else if (tab === "upcoming") {
    const active = await queryViewItems(owner.id, { type: "task", statusCategory: "active" }, { field: "plan", dir: "asc" });
    // 7-day window starting at today + weekOffset*7
    const windowStart = new Date(dueToday.getTime() + weekOffset * 7 * DAY_MS);
    const days = Array.from({ length: 7 }, (_, i) => new Date(windowStart.getTime() + i * DAY_MS));
    const byDay = new Map<string, ListedItem[]>();
    for (const t of active) {
      const d = effDate(t);
      if (d == null || d <= dueToday) continue; // future only (overdue/today live on Today)
      const k = dayKey(d);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(t);
    }
    const label = weekOffset === 0 ? "Current" : `+${weekOffset} week${weekOffset === 1 ? "" : "s"}`;
    selectableIds = days.flatMap((d) => (byDay.get(dayKey(d)) ?? []).map((t) => t.id));
    body = (
      <div className="mt-4">
        {/* week nav + day-jump chips */}
        <div className="flex flex-wrap items-center gap-2 pb-2">
          {days.map((d, i) => (
            <a key={i} href={`#day-${i}`} className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300">
              {shortDay.format(d)}
            </a>
          ))}
          {/* week navigator — far right (Tyler) */}
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={`/tasks?tab=upcoming&week=${Math.max(0, weekOffset - 1)}`}
              aria-disabled={weekOffset === 0}
              className={`rounded px-2 py-0.5 text-sm ${weekOffset === 0 ? "pointer-events-none text-neutral-700" : "text-neutral-400 hover:text-neutral-200"}`}
            >
              ←
            </Link>
            <span className="text-sm font-medium text-neutral-200">{label}</span>
            <Link href={`/tasks?tab=upcoming&week=${weekOffset + 1}`} className="rounded px-2 py-0.5 text-sm text-neutral-400 hover:text-neutral-200">
              →
            </Link>
          </div>
        </div>
        <div className="space-y-4">
          {days.map((d, i) => {
            const items = byDay.get(dayKey(d)) ?? [];
            const isToday = dayKey(d) === dayKey(dueToday);
            return (
              <div key={i} id={`day-${i}`}>
                <h3 className="border-b border-neutral-800/60 px-2 pb-1 text-sm font-semibold text-neutral-200">
                  {dayFmt.format(d)} · {isToday ? "Today" : weekdayFmt.format(d)}
                </h3>
                {items.length > 0 && <TaskList tasks={items} dueToday={dueToday} statuses={statuses} />}
                <InlineAddTask dueYmd={dayKey(d)} />
              </div>
            );
          })}
        </div>
      </div>
    );
  } else if (tab === "planner") {
    // Drag-to-schedule calendar over all active tasks (ADR-131). Defaults to the
    // multi-day time-grid (it self-navigates by day, so no ?month param is needed
    // alongside ?tab); the in-tab Month toggle shows the current month, and the
    // dedicated /planner destination carries full month navigation. No row
    // selection on a calendar layout (defer-by-hiding, ADR-118).
    const active = await queryViewItems(owner.id, { type: "task", statusCategory: "active" }, { field: "plan", dir: "asc" });
    const plannerView: ViewDefinition = {
      id: "tasks-planner",
      name: "Planner",
      isSystem: false,
      filter: { type: "task", statusCategory: "active" },
      sort: { field: "plan", dir: "asc" },
      grouping: null,
      columns: null,
      layout: "calendar",
      dateProperty: "scheduledDate",
      display: { mode: "timegrid", placeBy: "scheduled" },
      createdAt: new Date(),
    };
    body = <ViewRenderer view={plannerView} items={active} statuses={statuses} />;
  } else {
    // projects: each project + its open tasks
    const projects = await queryViewItems(owner.id, { type: "project" }, { field: "updatedAt", dir: "desc" });
    const projStatuses = resolveStatusSchema((await getType("project")).statusSchema);
    const cards = await Promise.all(
      projects.map(async (p) => ({
        project: p,
        tasks: await queryViewItems(owner.id, { type: "task", relatedTo: p.id, statusCategory: "active" }, { field: "dueDate", dir: "asc" }),
      }))
    );
    selectableIds = cards.flatMap(({ tasks }) => tasks.map((t) => t.id));
    body =
      cards.length === 0 ? (
        <p className="mt-6 px-2 text-sm text-neutral-600">No projects yet. Create one to gather its tasks, notes, and events.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {cards.map(({ project, tasks }) => {
            const ps = projStatuses.find((s) => s.key === project.status);
            return (
              <div key={project.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/items/${project.id}`} className="truncate font-semibold text-neutral-100 hover:text-[var(--accent)]">
                    {project.title || "Untitled project"}
                  </Link>
                  {ps && (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
                      {ps.color && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ps.color }} />}
                      {ps.label}
                    </span>
                  )}
                </div>
                {tasks.length > 0 ? (
                  <TaskList tasks={tasks} dueToday={dueToday} statuses={statuses} />
                ) : (
                  <p className="mt-2 px-2 text-xs text-neutral-600">No open tasks.</p>
                )}
                <div className="mt-1">
                  <InlineAddTask host={{ id: project.id, label: project.title || "Untitled project", role: "project" }} />
                </div>
              </div>
            );
          })}
        </div>
      );
  }

  return (
    <ListPage tab="tasks" title="Tasks" actions={<NewItemButton type="task" />}>
      {tabStrip}
      <SelectionProvider ids={selectableIds}>
        {/* Calendar layout renders no row checkboxes (ADR-118), so the planner
            tab gets no select toggle. */}
        {tab !== "planner" && <SelectModeToggle />}
        {body}
        {tab === "today" && (
          <div className="mt-3">
            <InlineAddTask dueYmd={dayKey(dueToday)} />
          </div>
        )}
        {tab === "inbox" && (
          <div className="mt-3">
            <InlineAddTask />
          </div>
        )}
        <BulkActionBar {...bulkConfigForType(taskType)} />
      </SelectionProvider>
    </ListPage>
  );
}
