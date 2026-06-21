// "+ Add task" → expands the shared AddTaskCard in place (Tyler: the same card
// everywhere a task is added). Used per-day in Upcoming, under Today/Inbox, and
// in each project card. Prefills the day's due date / the project.
"use client";

import { useState } from "react";
import AddTaskCard from "./AddTaskCard";

export default function InlineAddTask({
  dueYmd,
  host,
  label = "Add task",
}: {
  dueYmd?: string;
  host?: { id: string; label: string; role?: string };
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="my-1.5">
        <AddTaskCard
          defaultDueYmd={dueYmd}
          host={host}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-500 hover:text-neutral-300"
    >
      <span className="text-base leading-none text-[var(--accent)]">+</span> {label}
    </button>
  );
}
