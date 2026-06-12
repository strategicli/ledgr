// Today, the Work-surface home (PRD §4.2, §4.11 Phase 1 fixed layout):
// quick capture, today's meetings, due/overdue tasks, recent items. One
// batched fetch via getTodayData; widgets and user arrangement are Phase 2.
import Link from "next/link";
import QuickCapture from "@/components/today/QuickCapture";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import { listItems } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 px-2 text-sm text-neutral-600">{children}</p>;
}

function TaskRow({ task, overdue }: { task: ListedItem; overdue: boolean }) {
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
      {(task.urgency === "high" || task.urgency === "critical") && (
        <span className="shrink-0 rounded bg-amber-950 px-1.5 text-xs text-amber-400">
          {task.urgency}
        </span>
      )}
      <span
        className={`shrink-0 text-xs ${
          overdue ? "text-red-400" : "text-neutral-600"
        }`}
      >
        {task.dueDate ? dueFmt.format(task.dueDate) : ""}
      </span>
    </li>
  );
}

export default async function Today() {
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

  const { bounds, meetings, dueTasks, recent } = await getTodayData(owner.id);
  const overdue = dueTasks.filter(
    (t) => t.dueDate && t.dueDate < bounds.dueToday
  );
  const dueToday = dueTasks.filter(
    (t) => t.dueDate && t.dueDate >= bounds.dueToday
  );

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
                    } ${m.status === "done" ? "line-through opacity-60" : ""}`}
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

        <Section title="Tasks">
          {dueTasks.length > 0 ? (
            <ul className="mt-1">
              {overdue.map((t) => (
                <TaskRow key={t.id} task={t} overdue />
              ))}
              {dueToday.map((t) => (
                <TaskRow key={t.id} task={t} overdue={false} />
              ))}
            </ul>
          ) : (
            <Empty>Nothing due. Capture something above.</Empty>
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
                    {item.type}
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

        <p className="mt-10 text-sm">
          <Link href="/items" className="text-neutral-500 hover:text-neutral-300">
            All items →
          </Link>
        </p>
      </div>
    </main>
  );
}
