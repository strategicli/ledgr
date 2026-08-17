// The shared task list row (extracted from /tasks, 2026-08-17): checkbox +
// subtask circle + tags + title + P-badge + status chip + date, wrapped in the
// standard interaction layer — SwipeRow (right = complete, left = schedule) or,
// for a task with subtasks, the expandable "n/m" pill row (ADR-142). Used by
// the Tasks tabs and by a record's full task list (/items/[id]/collection/tasks)
// so the two never drift. Server-renderable; the interactive bits are the
// client children it composes.
import Link from "next/link";
import SwipeRow from "@/components/lists/SwipeRow";
import MilestoneFlag from "@/components/milestones/MilestoneFlag";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import SubtaskExpandableRow from "@/components/subtasks/SubtaskExpandableRow";
import TagChips, { type TagRef } from "@/components/relations/TagChips";
import { priorityStyle, type Priority } from "@/lib/priority";
import type { Progress } from "@/lib/subtasks";
import type { StatusDef } from "@/lib/status";

// Structural row shape — what queryViewItems rows carry, narrowed to what the
// row renders, so any list surface's rows fit without conversion.
export type TaskRowItem = {
  id: string;
  title: string;
  status: string;
  statusCategory: string;
  dueDate: Date | null;
  scheduledDate: Date | null;
  urgency: number | null;
};

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// The date that places a task: its effective plan date — scheduled (planned)
// day if set, else the due deadline (ADR-109); undated when neither is set.
export function effTaskDate(t: {
  scheduledDate: Date | null;
  dueDate: Date | null;
}): Date | null {
  return t.scheduledDate ?? t.dueDate ?? null;
}

export const TASK_ROW_CLASS =
  "group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60";

export function TaskRow({
  task,
  dueToday,
  statuses,
  rollup,
  today,
  tags,
  milestone,
}: {
  task: TaskRowItem;
  dueToday: Date;
  statuses: StatusDef[];
  rollup?: Progress;
  today: string;
  tags?: TagRef[];
  // The milestone this task completes (record-context surfaces pass it via
  // milestoneFlagsFor); renders as a subtle flag chip after the title.
  milestone?: { id: string; title: string };
}) {
  const done = task.statusCategory === "done";
  const sdef = statuses.find((s) => s.key === task.status);
  const date = effTaskDate(task);
  const overdue = !done && date != null && date < dueToday;
  const pri = task.urgency != null ? (task.urgency as Priority) : null;
  const inner = (
    <>
      <SelectCheckbox id={task.id} />
      <SubtaskCheckbox id={task.id} done={done} />
      {/* Tags at the leading edge, before the title (Tyler: "show on the task to
          the left of it somewhere"). Read-only here; the Tags field on the canvas
          is where they're edited. If the ragged left edge this gives the title
          column reads worse than the Todoist placement (chips AFTER the title),
          moving this one line below the Link is the whole change. */}
      <TagChips tags={tags ?? []} />
      <Link
        href={`/items/${task.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${task.title ? "text-neutral-200" : "text-neutral-500"} ${done ? "line-through opacity-60" : ""}`}
      >
        {task.title || "Untitled"}
      </Link>
      {milestone && <MilestoneFlag id={milestone.id} title={milestone.title} />}
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
    </>
  );
  // Trash + Complete/Focus/Schedule live in the shared row menu (right-click /
  // long-press), not an always-visible button; task rows also swipe (right =
  // complete, left = schedule). ADR-142, mirroring /list/[type].
  const menuOpts = {
    id: task.id,
    canComplete: true,
    done,
    today,
    label: task.title || "Untitled",
  };
  // A task with task-children gets the expandable pill (which carries the menu);
  // everything else stays a plain flat row with swipe + menu.
  if (rollup && rollup.total > 0) {
    return (
      <SubtaskExpandableRow id={task.id} done={rollup.done} total={rollup.total} liClassName={TASK_ROW_CLASS} menuOptions={menuOpts}>
        {inner}
      </SubtaskExpandableRow>
    );
  }
  return (
    <SwipeRow className={TASK_ROW_CLASS} {...menuOpts}>
      {inner}
    </SwipeRow>
  );
}

export default function TaskList({
  tasks,
  dueToday,
  statuses,
  rollups,
  today,
  tagsBySource,
  milestonesByTask,
}: {
  tasks: TaskRowItem[];
  dueToday: Date;
  statuses: StatusDef[];
  rollups?: Map<string, Progress>;
  today: string;
  tagsBySource?: Map<string, TagRef[]>;
  // taskId → the milestone it completes (milestoneFlagsFor); record-context
  // surfaces pass it, the global Tasks tabs leave it undefined.
  milestonesByTask?: Map<string, { id: string; title: string }>;
}) {
  return (
    <ul className="mt-1">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          dueToday={dueToday}
          statuses={statuses}
          rollup={rollups?.get(t.id)}
          today={today}
          tags={tagsBySource?.get(t.id)}
          milestone={milestonesByTask?.get(t.id)}
        />
      ))}
    </ul>
  );
}
