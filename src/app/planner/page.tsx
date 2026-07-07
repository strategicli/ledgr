// The Planner (ADR-131): a drag-to-schedule calendar over all active tasks, as
// a first-class Work destination. Reuses the view engine — a synthesized
// calendar View Definition (scheduled_date placement, scheduled by default) run
// through the shared owner-scoped, body-free query and handed to ViewRenderer,
// which mounts the interactive PlannerCalendar (month grid + multi-day
// time-grid). Month navigation rides ?month (calendarNavHref="/planner").
import { redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import ViewRenderer from "@/components/views/ViewRenderer";
import { resolveOwner } from "@/lib/owner";
import { getAppTimezone } from "@/lib/today";
import { resolveStatusSchema } from "@/lib/status";
import { getType } from "@/lib/types";
import { queryViewItems, type ViewDefinition } from "@/lib/views";
import { listCalendarEventsForRange } from "@/lib/calendar/feed";
import { overlayWindow } from "@/lib/calendar/overlay";

export const dynamic = "force-dynamic";

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  const sp = await searchParams;
  const month =
    typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : undefined;

  const view: ViewDefinition = {
    id: "planner",
    name: "Planner",
    isSystem: false,
    filter: { type: "task", statusCategory: "active" },
    sort: { field: "plan", dir: "asc" },
    grouping: null,
    columns: null,
    layout: "calendar",
    dateProperty: "scheduledDate",
    display: { mode: "month", placeBy: "scheduled" },
    createdAt: new Date(),
  };

  const win = overlayWindow(month);
  const [items, calendarEvents, taskType] = await Promise.all([
    queryViewItems(owner.id, view.filter, view.sort),
    listCalendarEventsForRange(owner.id, win.start, win.end),
    getType("task"),
  ]);
  const statuses = resolveStatusSchema(taskType.statusSchema);
  const tz = await getAppTimezone(owner.id);

  return (
    <ListPage tab="planner" title="Planner" actions={<NewItemButton type="task" />} wide>
      <p className="mt-1 text-sm text-neutral-500">
        {items.length} active task{items.length === 1 ? "" : "s"} · drag to schedule
      </p>
      <ViewRenderer
        view={view}
        items={items}
        statuses={statuses}
        month={month}
        calendarNavHref="/planner"
        calendarEvents={calendarEvents}
        tz={tz}
      />
    </ListPage>
  );
}
