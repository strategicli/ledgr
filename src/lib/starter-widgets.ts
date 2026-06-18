// Starter widgets: ready-made dashboards widgets for the common cases, so a user
// doesn't have to build a view first. Each is a real ViewInput — picking one
// creates (or reuses) the backing saved view and adds it as a widget, so it
// still obeys "every widget is a real view" (it just skips the view builder).
// Client-safe (type-only import from views); the filters use the existing
// ViewFilter shape (due / withinDays / dateField), so no engine change.
import type { ViewInput } from "@/lib/views";

export type StarterWidget = {
  id: string;
  label: string;
  description: string;
  view: ViewInput;
};

const list = (
  name: string,
  filter: ViewInput["filter"],
  sort: ViewInput["sort"]
): ViewInput => ({
  name,
  filter,
  sort,
  grouping: null,
  columns: null,
  layout: "list",
  dateProperty: null,
});

export const STARTER_WIDGETS: StarterWidget[] = [
  {
    id: "todays-focus",
    label: "Today's Focus",
    description: "The vital few you starred for today (Top 3)",
    view: list(
      "Today's Focus",
      { type: "task", statusCategory: "active", focusedToday: true },
      { field: "scheduledDate", dir: "asc" }
    ),
  },
  {
    id: "tasks-due-today",
    label: "Tasks Due Today",
    description: "Open tasks due today",
    view: list(
      "Tasks Due Today",
      { type: "task", statusCategory: "active", dateField: "dueDate", due: "today" },
      { field: "dueDate", dir: "asc" }
    ),
  },
  {
    id: "overdue-tasks",
    label: "Overdue Tasks",
    description: "Open tasks past their due date",
    view: list(
      "Overdue Tasks",
      { type: "task", statusCategory: "active", dateField: "dueDate", due: "overdue" },
      { field: "dueDate", dir: "asc" }
    ),
  },
  {
    id: "upcoming-tasks",
    label: "Upcoming Tasks",
    description: "Open tasks due in the next 7 days",
    view: list(
      "Upcoming Tasks",
      { type: "task", statusCategory: "active", dateField: "dueDate", withinDays: 7 },
      { field: "dueDate", dir: "asc" }
    ),
  },
  {
    id: "meetings-this-week",
    label: "Meetings This Week",
    description: "Meetings scheduled in the next 7 days",
    view: list(
      "Meetings This Week",
      { type: "meeting", dateField: "meetingAt", withinDays: 7 },
      { field: "meetingAt", dir: "asc" }
    ),
  },
  {
    id: "recently-updated",
    label: "Recently Updated",
    description: "Everything you touched most recently",
    view: list("Recently Updated", {}, { field: "updatedAt", dir: "desc" }),
  },
];
