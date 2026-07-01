"use client";

// Tasks widget body (Project Type): the record's contained tasks as a first-class
// list. Each row uses the SAME completion circle as the task type (TaskCheckCircle
// — fills with the user's highlight color when done). Adding a task expands the
// shared AddTaskCard with this project pre-selected; since the destination is
// already this project, the destination picker is hidden (lockDestination), which
// leaves the Add / Cancel buttons the room they need (Tyler, 2026-07-01).
import Link from "next/link";
import InlineAddTask from "@/components/tasks/InlineAddTask";
import TaskCheckCircle from "@/components/tasks/TaskCheckCircle";

type Row = { id: string; title: string; statusCategory: string; urgency: number | null; recurrence: string | null };

export default function TasksWidget({
  recordId,
  projectTitle,
  items,
}: {
  recordId: string;
  projectTitle: string;
  items: Row[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 && <p className="text-sm text-neutral-500">No tasks yet.</p>}
      <ul className="flex flex-col gap-1.5">
        {items.map((t) => {
          const done = t.statusCategory === "done";
          return (
            <li key={t.id} className="flex items-center gap-2.5 text-sm">
              <TaskCheckCircle itemId={t.id} done={done} priority={t.urgency} />
              <Link
                href={`/items/${t.id}`}
                className={`min-w-0 flex-1 truncate hover:text-neutral-200 ${done ? "text-neutral-500 line-through" : "text-neutral-200"}`}
              >
                {t.title || "Untitled"}
                {/* Recurrence reads inline, in the accent color, right in the
                    flow of the task name (Tyler): "Water the plants Weekly on Mon". */}
                {t.recurrence && !done && (
                  <span className="text-[var(--accent)]"> {t.recurrence}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-0.5">
        <InlineAddTask
          host={{ id: recordId, label: projectTitle || "This project", role: "project" }}
          lockDestination
        />
      </div>
    </div>
  );
}
