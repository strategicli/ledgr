// Tasks list (PRD §4.2): filterable by status, urgency, a date window, and
// related person. The "Date" selector chooses which date — the due deadline or
// the scheduled plan (ADR-076) — the window filters and the list sorts by; the
// URL carries the filter (FilterBar contract). Absent status means active (the
// daily-driver default). Sorted by the chosen date, undated last.
import Link from "next/link";
import { redirect } from "next/navigation";
import FilterBar, { type FilterSelect } from "@/components/lists/FilterBar";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import { URGENCIES, type Urgency } from "@/lib/item-enums";
import { resolveOwner } from "@/lib/owner";
import { resolveStatusSchema, type StatusDef } from "@/lib/status";
import { todayBounds } from "@/lib/today";
import { getType } from "@/lib/types";
import {
  DUE_WINDOWS,
  listPersonOptions,
  PROPERTY_FILTER_NONE,
  propertyFilterOptions,
  propertyFiltersFromParams,
  queryViewItems,
  type DueWindow,
  type ViewFilter,
} from "@/lib/views";

export const dynamic = "force-dynamic";

type ListedItem = Awaited<ReturnType<typeof queryViewItems>>[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Due dates are calendar days stored as UTC midnight; format in UTC so the
// shown day can't shift with the timezone (ADR-008).
const dueFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function TaskRow({
  task,
  dueToday,
  dateField,
  statuses,
}: {
  task: ListedItem;
  dueToday: Date;
  dateField: "dueDate" | "scheduledDate";
  statuses: StatusDef[];
}) {
  const done = task.statusCategory === "done";
  const sdef = statuses.find((s) => s.key === task.status);
  // Show the date for the dimension the list is working in, and flag it
  // red when it's in the past (a missed deadline, or a planned day gone by).
  const date = dateField === "scheduledDate" ? task.scheduledDate : task.dueDate;
  const overdue = !done && date != null && date < dueToday;
  // "Planned" (S6, ADR-086): in the due dimension, a task with a plan date but no
  // deadline is planned work, not deadline-driven — mark it so the empty due
  // column doesn't read as "no date at all" (mirrors the Today marker, ADR-077).
  const planned =
    !done && dateField === "dueDate" && !task.dueDate && task.scheduledDate != null;
  return (
    <li className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60">
      <SubtaskCheckbox id={task.id} done={done} />
      <Link
        href={`/items/${task.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${
          task.title ? "text-neutral-200" : "text-neutral-500"
        } ${done ? "line-through opacity-60" : ""}`}
      >
        {task.title || "Untitled"}
      </Link>
      {sdef && sdef.category !== "not_started" && (
        // Secondary detail: hidden on phones to keep the title readable; the
        // full status shows on sm+ and on the item canvas.
        <span className="hidden shrink-0 items-center gap-1 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400 sm:inline-flex">
          {sdef.color && (
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: sdef.color }}
            />
          )}
          {sdef.label}
        </span>
      )}
      {(task.urgency === "high" || task.urgency === "critical") && (
        <span className="shrink-0 rounded bg-amber-950 px-1.5 text-xs text-amber-400">
          {task.urgency}
        </span>
      )}
      {planned && (
        <span
          className="shrink-0 text-xs text-neutral-600"
          title={`Planned for ${dueFmt.format(task.scheduledDate as Date)} (no deadline)`}
        >
          planned {dueFmt.format(task.scheduledDate as Date)}
        </span>
      )}
      <span
        className={`shrink-0 text-xs ${
          overdue ? "text-red-400" : "text-neutral-600"
        }`}
      >
        {date ? dueFmt.format(date) : ""}
      </span>
      <RowAction id={task.id} action="trash" />
    </li>
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
  const param = (key: string) =>
    typeof sp[key] === "string" ? (sp[key] as string) : undefined;

  const filter: ViewFilter = { type: "task" };
  // Status filter (S2): "active" (default) → the not-started/in-progress bucket;
  // "any" → no status filter; anything else is an exact status key.
  const statusParam = param("status") ?? "active";
  if (statusParam === "active") filter.statusCategory = "active";
  else if (statusParam !== "any") filter.status = statusParam;
  const urgency = param("urgency");
  if (URGENCIES.includes(urgency as Urgency)) {
    filter.urgency = urgency as Urgency;
  }
  // Which date dimension this list works in: it drives both the date-window
  // filter and the sort. Due (the deadline) is the default; scheduled (the
  // planned date, ADR-076) is the "when I'll actually do it" lens.
  const dateField =
    param("datefield") === "scheduled" ? "scheduledDate" : "dueDate";
  filter.dateField = dateField;
  const when = param("when");
  if (DUE_WINDOWS.includes(when as DueWindow)) filter.due = when as DueWindow;
  const person = param("person");
  if (person && UUID_RE.test(person)) filter.relatedTo = person;

  // The task type's own custom select/multi_select properties become filters
  // too (e.g. a "context" or "area" the user added). Scoped to the schema so a
  // stray prop_ param can't inject a predicate.
  const taskType = await getType("task");
  const statuses = resolveStatusSchema(taskType.statusSchema);
  const filterProps = propertyFilterOptions(taskType.propertySchema);
  const propFilters = propertyFiltersFromParams(sp, taskType.propertySchema);
  if (propFilters.length) filter.propertyFilters = propFilters;

  const [tasks, people] = await Promise.all([
    queryViewItems(owner.id, filter, { field: dateField, dir: "asc" }),
    listPersonOptions(owner.id),
  ]);
  const { dueToday } = todayBounds();

  const selects: FilterSelect[] = [
    {
      param: "status",
      label: "Status",
      defaultValue: "active",
      options: [
        { value: "active", label: "active" },
        ...statuses.map((s) => ({ value: s.key, label: s.label })),
        { value: "any", label: "any" },
      ],
    },
    {
      param: "urgency",
      label: "Urgency",
      options: [
        { value: "", label: "any" },
        ...URGENCIES.map((u) => ({ value: u, label: u })),
      ],
    },
    {
      param: "datefield",
      label: "Date",
      defaultValue: "due",
      options: [
        { value: "due", label: "due" },
        { value: "scheduled", label: "scheduled" },
      ],
    },
    {
      param: "when",
      label: "When",
      options: [
        { value: "", label: "any" },
        { value: "overdue", label: "overdue" },
        { value: "today", label: "today" },
        { value: "week", label: "next 7 days" },
        { value: "none", label: "no date" },
      ],
    },
    {
      param: "person",
      label: "Person",
      options: [
        { value: "", label: "any" },
        ...people.map((p) => ({
          value: p.id,
          label: p.title || "Untitled",
        })),
      ],
    },
    ...filterProps.map((fp) => ({
      param: `prop_${fp.key}`,
      label: fp.label,
      options: [
        { value: "", label: "any" },
        ...fp.options.map((o) => ({ value: o, label: o })),
        { value: PROPERTY_FILTER_NONE, label: "not set" },
      ],
    })),
  ];

  return (
    <ListPage
      tab="tasks"
      title="Tasks"
      subtitle={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
      actions={<NewItemButton type="task" />}
    >
      <div className="mt-4">
        <FilterBar selects={selects} />
      </div>
      {tasks.length > 0 ? (
        <ul className="mt-4">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              dueToday={dueToday}
              dateField={dateField}
              statuses={statuses}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-6 px-2 text-sm text-neutral-600">
          No tasks match these filters.
        </p>
      )}
    </ListPage>
  );
}
