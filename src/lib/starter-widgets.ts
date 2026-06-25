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
    label: "Tasks Today",
    description: "Open tasks planned or due today",
    view: list(
      "Tasks Today",
      { type: "task", statusCategory: "active", dateField: "plan", due: "today" },
      { field: "plan", dir: "asc" }
    ),
  },
  {
    id: "overdue-tasks",
    label: "Overdue Tasks",
    description: "Open tasks past their planned date",
    view: list(
      "Overdue Tasks",
      { type: "task", statusCategory: "active", dateField: "plan", due: "overdue" },
      { field: "plan", dir: "asc" }
    ),
  },
  {
    id: "upcoming-tasks",
    label: "Upcoming Tasks",
    description: "Open tasks planned or due in the next 7 days",
    view: list(
      "Upcoming Tasks",
      { type: "task", statusCategory: "active", dateField: "plan", withinDays: 7 },
      { field: "plan", dir: "asc" }
    ),
  },
  {
    id: "meetings-this-week",
    label: "Events This Week",
    description: "Events scheduled in the next 7 days",
    view: list(
      "Events This Week",
      { type: "event", dateField: "meetingAt", withinDays: 7 },
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
