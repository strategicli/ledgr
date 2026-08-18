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
import TabStrip from "@/components/nav/TabStrip";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import TaskList, { effTaskDate } from "@/components/tasks/TaskListRow";
import { outgoingRelationsBySource } from "@/lib/relations";
import { TAGS_ROLE } from "@/lib/tags";
import { childRollups } from "@/lib/subtasks";
import { staleProjects } from "@/lib/digest/stale";
import { bulkConfigForType } from "@/lib/bulk-config";
import { priorityStyle, prioritySortKey, type Priority } from "@/lib/priority";
import { resolveOwner } from "@/lib/owner";
import { appTodayYmd } from "@/lib/recurrence-service";
import { resolveStatusSchema } from "@/lib/status";
import { getAppTimezone, todayBounds } from "@/lib/today";
import { getType } from "@/lib/types";
import { queryViewItems, type ViewDefinition } from "@/lib/views";
import { listCalendarEventsForRange } from "@/lib/calendar/feed";
import { overlayWindow } from "@/lib/calendar/overlay";

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
// The shared task row + list moved to components/tasks/TaskListRow.tsx
// (2026-08-17) so a record's full task list renders the same rows as these tabs.
const effDate = effTaskDate;

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
  const tz = await getAppTimezone(owner.id);
  const { dueToday } = todayBounds(new Date(), tz);
  // App-timezone today (YYYY-MM-DD) for the row menu's Focus + Schedule quick
  // dates (ADR-142). Named `todayYmd` to avoid the "today" tab's local `today`
  // (a filtered task array) shadowing it.
  const todayYmd = appTodayYmd(new Date(), tz);

  const tabStrip = (
    <TabStrip
      className="mt-4 border-b border-neutral-800"
      navHrefs={TABS.map((t) => `/tasks?tab=${t.key}`)}
      activeIndex={TABS.findIndex((t) => t.key === tab)}
    >
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/tasks?tab=${t.key}`}
          data-tab-active={tab === t.key ? "" : undefined}
          className={`whitespace-nowrap rounded-t px-3 py-1.5 text-sm ${
            tab === t.key ? "border-b-2 border-[var(--accent)] text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </TabStrip>
  );

  let body: React.ReactNode = null;
  // The selectable task ids on the active tab, in display order (powers the
  // multi-select range + select-all). Project headers and inline-add rows aren't
  // selectable; only task rows are.
  let selectableIds: string[] = [];

  if (tab === "today") {
    const active = await queryViewItems(owner.id, { type: "task", statusCategory: "active" }, { field: "plan", dir: "asc" });
    const onPlate = active.filter((t) => {
      const d = effDate(t);
      return d != null && d <= dueToday;
    });
    // Overdue (effective date strictly before today) gets its own group above the
    // priority groups (Todoist-style); the rest — due exactly today — group by
    // priority so an overdue item shows once, in Overdue, not also under a
    // priority. Overdue keeps the query's plan-asc order (oldest first).
    const overdue = onPlate.filter((t) => {
      const d = effDate(t);
      return d != null && d < dueToday;
    });
    const dueNow = onPlate.filter((t) => {
      const d = effDate(t);
      return d != null && d >= dueToday;
    });
    // group the rest by priority (1..6; null → 6/none)
    const groups = new Map<number, ListedItem[]>();
    for (const t of dueNow) {
      const k = prioritySortKey(t.urgency != null ? (t.urgency as Priority) : null);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
    selectableIds = [
      ...overdue.map((t) => t.id),
      ...ordered.flatMap(([, items]) => items.map((t) => t.id)),
    ];
    const rollups = await childRollups(owner.id, selectableIds);
    // Tag chips for the rows about to render. One batched query keyed on the
    // ids already computed for selection, so it costs a single extra round trip
    // per page rather than one per row (the no-N+1 perf rule).
    const tagsBySource = await outgoingRelationsBySource(owner.id, selectableIds, TAGS_ROLE);
    // Projects gone quiet (Tyler, 2026-08-17): active projects not opened or
    // touched within their per-project window surface here as P1-styled
    // check-in rows — virtual rows, not real tasks (no data to clean up;
    // opening the project makes the row disappear, because the view beacon
    // resets the clock). Per-project opt-out lives on the project itself.
    const quiet = await staleProjects(owner.id);
    const quietSection =
      quiet.length > 0 ? (
        <div>
          <h3 className={`px-2 text-xs font-semibold uppercase tracking-wide ${priorityStyle(1).text}`}>
            Check in
          </h3>
          <ul className="mt-1">
            {quiet.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/items/${p.id}`}
                  className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
                >
                  <span className={`shrink-0 rounded border px-1.5 text-xs ${priorityStyle(1).text} ${priorityStyle(1).border}`}>
                    P1
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                    Check on {p.title}
                  </span>
                  <span className="shrink-0 text-xs text-neutral-600">
                    quiet {p.daysQuiet}d
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null;
    body =
      onPlate.length === 0 && !quietSection ? (
        <p className="mt-6 px-2 text-sm text-neutral-600">Nothing due today. 🎉</p>
      ) : onPlate.length === 0 ? (
        <div className="mt-4 space-y-4">
          {quietSection}
          <p className="px-2 text-sm text-neutral-600">Nothing due today. 🎉</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {quietSection}
          {overdue.length > 0 && (
            <div>
              <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-red-400">
                Overdue
              </h3>
              <TaskList tasks={overdue} dueToday={dueToday} statuses={statuses} rollups={rollups} today={todayYmd} tagsBySource={tagsBySource} />
            </div>
          )}
          {ordered.map(([k, items]) => {
            const s = priorityStyle(k as Priority);
            return (
              <div key={k}>
                <h3 className={`px-2 text-xs font-semibold uppercase tracking-wide ${s.text}`}>
                  {k === 6 ? "No priority" : `Priority ${k}`}
                </h3>
                <TaskList tasks={items} dueToday={dueToday} statuses={statuses} rollups={rollups} today={todayYmd} tagsBySource={tagsBySource} />
              </div>
            );
          })}
        </div>
      );
  } else if (tab === "inbox") {
    const inbox = await queryViewItems(owner.id, { type: "task", inbox: true, statusCategory: "active" }, { field: "createdAt", dir: "desc" });
    selectableIds = inbox.map((t) => t.id);
    const rollups = await childRollups(owner.id, selectableIds);
    // Tag chips for the rows about to render. One batched query keyed on the
    // ids already computed for selection, so it costs a single extra round trip
    // per page rather than one per row (the no-N+1 perf rule).
    const tagsBySource = await outgoingRelationsBySource(owner.id, selectableIds, TAGS_ROLE);
    body =
      inbox.length === 0 ? (
        <p className="mt-6 px-2 text-sm text-neutral-600">Inbox zero. Quick-capture lands here for triage.</p>
      ) : (
        <TaskList tasks={inbox} dueToday={dueToday} statuses={statuses} rollups={rollups} today={todayYmd} tagsBySource={tagsBySource} />
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
    const rollups = await childRollups(owner.id, selectableIds);
    // Tag chips for the rows about to render. One batched query keyed on the
    // ids already computed for selection, so it costs a single extra round trip
    // per page rather than one per row (the no-N+1 perf rule).
    const tagsBySource = await outgoingRelationsBySource(owner.id, selectableIds, TAGS_ROLE);
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
                {items.length > 0 && <TaskList tasks={items} dueToday={dueToday} statuses={statuses} rollups={rollups} today={todayYmd} tagsBySource={tagsBySource} />}
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
    const win = overlayWindow();
    const [active, calendarEvents] = await Promise.all([
      queryViewItems(owner.id, { type: "task", statusCategory: "active" }, { field: "plan", dir: "asc" }),
      listCalendarEventsForRange(owner.id, win.start, win.end),
    ]);
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
    body = <ViewRenderer view={plannerView} items={active} statuses={statuses} calendarEvents={calendarEvents} today={todayYmd} tz={tz} />;
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
    const rollups = await childRollups(owner.id, selectableIds);
    // Same batched tag read as the other tabs — one query for every task across
    // every project card, not one per card.
    const tagsBySource = await outgoingRelationsBySource(owner.id, selectableIds, TAGS_ROLE);
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
                  <TaskList tasks={tasks} dueToday={dueToday} statuses={statuses} rollups={rollups} today={todayYmd} tagsBySource={tagsBySource} />
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
    <ListPage tab="tasks" title="Tasks" actions={<NewItemButton type="task" />} wide={tab === "planner"}>
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
