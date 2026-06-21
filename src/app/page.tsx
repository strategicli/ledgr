// Today, the Work-surface home (PRD §4.2, §4.11 Phase 1 fixed layout):
// quick capture, today's meetings, due/overdue tasks, recent items. One
// batched fetch via getTodayData; widgets and user arrangement are Phase 2.
import Link from "next/link";
import DashboardView from "@/components/dashboards/DashboardView";
import QuickCapture from "@/components/today/QuickCapture";
import PushToggle from "@/components/pwa/PushToggle";
import RollOverdueButton from "@/components/today/RollOverdueButton";
import FocusStar from "@/components/today/FocusStar";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import { FOCUS_SOFT_CAP, focusOrder, isFocusedOn } from "@/lib/focus";
import { listItems } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { APP_TIMEZONE, getTodayData } from "@/lib/today";

export const dynamic = "force-dynamic";

type ListedItem = Awaited<ReturnType<typeof listItems>>[number];

const headingFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: APP_TIMEZONE,
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});
// Due dates are calendar days stored as UTC midnight; format in UTC so the
// shown day can't shift with the timezone.
const dueFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const recentFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIMEZONE,
});

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 px-2 text-sm text-neutral-600">{children}</p>;
}

// The date a task is "on the plate" by: its planned (scheduled) date if set,
// else its deadline (native tasks T2). Drives the Today partition + the row date.
function planDate(task: ListedItem): Date | null {
  return task.scheduledDate ?? task.dueDate ?? null;
}

function TaskRow({
  task,
  overdue,
  today,
}: {
  task: ListedItem;
  overdue: boolean;
  today: string;
}) {
  const d = planDate(task);
  return (
    <li className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60">
      <SubtaskCheckbox id={task.id} done={false} />
      <Link
        href={`/items/${task.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${
          task.title ? "text-neutral-200" : "text-neutral-500"
        }`}
      >
        {task.title || "Untitled"}
      </Link>
      {/* A scheduled-but-not-due task is planned work; mark it so the date isn't
          mistaken for a deadline. */}
      {task.scheduledDate && !task.dueDate && (
        <span className="shrink-0 text-xs text-neutral-600">planned</span>
      )}
      {task.urgency != null && task.urgency <= 2 && (
        <span className="shrink-0 rounded bg-amber-950 px-1.5 text-xs text-amber-400">
          {`P${task.urgency}`}
        </span>
      )}
      <span
        className={`shrink-0 text-xs ${
          overdue ? "text-[var(--accent)]" : "text-neutral-600"
        }`}
      >
        {d ? dueFmt.format(d) : ""}
      </span>
      <FocusStar
        itemId={task.id}
        focused={isFocusedOn(task.properties, today)}
        today={today}
      />
    </li>
  );
}

// The Work home (/). If the owner has assigned a dashboard as Home, render it;
// otherwise the fixed Today layout below (the default + fallback). The Today
// surface (/today) mirrors this with todayDashboardId.
export default async function Home() {
  const owner = await resolveOwner();
  if (!owner) return <TodayHome />;
  const settings = await getSettings(owner.id);
  if (settings.homeDashboardId) {
    // Renders the dashboard, or falls back to the fixed Today layout if the
    // assigned dashboard was since deleted.
    return (
      <DashboardView
        ownerId={owner.id}
        dashboardId={settings.homeDashboardId}
        fallback={<TodayHome />}
      />
    );
  }
  return <TodayHome />;
}

export async function TodayHome() {
  const owner = await resolveOwner();
  if (!owner) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Ledgr</h1>
        <p className="text-sm text-neutral-500">
          Phase 1 scaffold. The Work surface starts here.
        </p>
      </main>
    );
  }

  const { bounds, meetings, dueTasks, recent, focusTasks, todayYmd, typeLabels } =
    await getTodayData(owner.id);
  // Today's Focus (T3): the vital few, ordered by the focus marker's order.
  const focus = [...focusTasks].sort(
    (a, b) => focusOrder(a.properties) - focusOrder(b.properties)
  );
  const focusedIds = new Set(focus.map((t) => t.id));
  // The due/planned list excludes anything already in the focus zone, so a task
  // shows once: in Focus if focused, else here.
  const rest = dueTasks.filter((t) => !focusedIds.has(t.id));
  // Partition on the effective plan date (scheduled, else due), so a task
  // planned for an earlier day counts as overdue even with no deadline.
  const overdue = rest.filter((t) => {
    const d = t.scheduledDate ?? t.dueDate;
    return d != null && d < bounds.dueToday;
  });
  const dueToday = rest.filter((t) => {
    const d = t.scheduledDate ?? t.dueDate;
    return d != null && d >= bounds.dueToday;
  });
  // Recurring series advance via completion, not the roll (recurrence-service.ts),
  // so the roll button only counts the non-recurring overdue it would actually move.
  const rollableOverdue = overdue.filter(
    (t) => !(t.properties as Record<string, unknown> | null)?.recurrence
  ).length;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          Today
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {headingFmt.format(new Date())}
        </p>

        <div className="mt-6">
          <QuickCapture />
        </div>

        {focus.length > 0 && (
          <Section
            title="Today's Focus"
            action={
              focus.length > FOCUS_SOFT_CAP ? (
                <span className="text-xs text-amber-500/80">
                  {focus.length} in focus (the vital few is usually {FOCUS_SOFT_CAP} or fewer)
                </span>
              ) : undefined
            }
          >
            <ul className="mt-1">
              {focus.map((t) => (
                <TaskRow key={t.id} task={t} overdue={false} today={todayYmd} />
              ))}
            </ul>
          </Section>
        )}

        <Section title="Meetings">
          {meetings.length > 0 ? (
            <ul className="mt-1">
              {meetings.map((m) => (
                <li
                  key={m.id}
                  className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
                >
                  <span className="w-16 shrink-0 text-xs tabular-nums text-neutral-500">
                    {m.meetingAt ? timeFmt.format(m.meetingAt) : ""}
                  </span>
                  <Link
                    href={`/items/${m.id}`}
                    className={`min-w-0 flex-1 truncate text-sm ${
                      m.title ? "text-neutral-200" : "text-neutral-500"
                    } ${m.statusCategory === "done" ? "line-through opacity-60" : ""}`}
                  >
                    {m.title || "Untitled"}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No meetings today.</Empty>
          )}
        </Section>

        <Section title="Tasks" action={<RollOverdueButton count={rollableOverdue} />}>
          {overdue.length + dueToday.length > 0 ? (
            <ul className="mt-1">
              {overdue.map((t) => (
                <TaskRow key={t.id} task={t} overdue today={todayYmd} />
              ))}
              {dueToday.map((t) => (
                <TaskRow key={t.id} task={t} overdue={false} today={todayYmd} />
              ))}
            </ul>
          ) : (
            <Empty>Nothing due or planned. Capture something above.</Empty>
          )}
        </Section>

        <Section title="Recent">
          {recent.length > 0 ? (
            <ul className="mt-1">
              {recent.map((item) => (
                <li
                  key={item.id}
                  className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
                >
                  <span className="w-16 shrink-0 truncate text-xs text-neutral-600">
                    {typeLabels[item.type] ?? item.type}
                  </span>
                  <Link
                    href={`/items/${item.id}`}
                    className={`min-w-0 flex-1 truncate text-sm ${
                      item.title ? "text-neutral-200" : "text-neutral-500"
                    }`}
                  >
                    {item.title || "Untitled"}
                  </Link>
                  <span className="shrink-0 text-xs text-neutral-600">
                    {recentFmt.format(item.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No items yet.</Empty>
          )}
        </Section>

        <p className="mt-10 flex flex-wrap items-center gap-4 text-sm">
          <Link href="/dashboards" className="text-neutral-500 hover:text-neutral-300">
            Dashboards →
          </Link>
          <Link href="/items" className="text-neutral-500 hover:text-neutral-300">
            All items →
          </Link>
          <PushToggle />
        </p>
      </div>
    </main>
  );
}
