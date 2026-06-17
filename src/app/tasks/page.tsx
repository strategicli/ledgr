// Tasks list (PRD §4.2): filterable by status, urgency, due window, and
// related person. The URL carries the filter (FilterBar contract); absent
// status means open, the daily-driver default. Sorted by due date, undated last.
import Link from "next/link";
import { redirect } from "next/navigation";
import FilterBar, { type FilterSelect } from "@/components/lists/FilterBar";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import {
  ITEM_STATUSES,
  URGENCIES,
  type ItemStatus,
  type Urgency,
} from "@/lib/item-enums";
import { resolveOwner } from "@/lib/owner";
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
}: {
  task: ListedItem;
  dueToday: Date;
}) {
  const done = task.status === "done";
  const overdue = !done && task.dueDate != null && task.dueDate < dueToday;
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
      {task.status === "archived" && (
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
          archived
        </span>
      )}
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
  const status = param("status") ?? "open";
  if (ITEM_STATUSES.includes(status as ItemStatus)) {
    filter.status = status as ItemStatus;
  }
  const urgency = param("urgency");
  if (URGENCIES.includes(urgency as Urgency)) {
    filter.urgency = urgency as Urgency;
  }
  const due = param("due");
  if (DUE_WINDOWS.includes(due as DueWindow)) filter.due = due as DueWindow;
  const person = param("person");
  if (person && UUID_RE.test(person)) filter.relatedTo = person;

  // The task type's own custom select/multi_select properties become filters
  // too (e.g. a "context" or "area" the user added). Scoped to the schema so a
  // stray prop_ param can't inject a predicate.
  const taskType = await getType("task");
  const filterProps = propertyFilterOptions(taskType.propertySchema);
  const propFilters = propertyFiltersFromParams(sp, taskType.propertySchema);
  if (propFilters.length) filter.propertyFilters = propFilters;

  const [tasks, people] = await Promise.all([
    queryViewItems(owner.id, filter, { field: "dueDate", dir: "asc" }),
    listPersonOptions(owner.id),
  ]);
  const { dueToday } = todayBounds();

  const selects: FilterSelect[] = [
    {
      param: "status",
      label: "Status",
      defaultValue: "open",
      options: [
        ...ITEM_STATUSES.map((s) => ({ value: s, label: s })),
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
      param: "due",
      label: "Due",
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
            <TaskRow key={task.id} task={task} dueToday={dueToday} />
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
