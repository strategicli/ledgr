// "+ Add task" → expands the shared AddTaskCard in place (Tyler: the same card
// everywhere a task is added). Used per-day in Upcoming, under Today/Inbox, and
// in each project card. Prefills the day's due date / the project.
//
// Optimistic add (perceived speed): when the card commits, it hands back a
// provisional task that we paint immediately as a muted row while the POST runs
// behind it. A coalesced refresh brings the real row from the server, and the
// shared flush signal clears the provisional one (a beat late, so there is a
// brief muted overlap rather than a gap). Mirrors how completing a task feels.
"use client";

import { useEffect, useState } from "react";
import AddTaskCard, { type OptimisticTask } from "./AddTaskCard";
import { onListRefreshFlush } from "@/lib/list-refresh";

export default function InlineAddTask({
  dueYmd,
  host,
  label = "Add task",
  lockDestination = false,
}: {
  dueYmd?: string;
  host?: { id: string; label: string; role?: string };
  label?: string;
  // When the destination is already known (e.g. a project's Tasks card), hide the
  // destination picker so the task always lands on the host.
  lockDestination?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<OptimisticTask[]>([]);

  // Drop provisional rows once a coalesced refresh has flushed — the real rows
  // are in the server tree by then.
  useEffect(() => onListRefreshFlush(() => setOptimistic([])), []);

  return (
    <>
      {optimistic.map((t) => (
        <div
          key={t.id}
          className="my-1 flex items-center gap-2 rounded-card px-2 py-1.5 text-sm text-ink-muted opacity-70"
        >
          <span
            aria-hidden
            className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-line-strong"
          />
          <span className="min-w-0 flex-1 truncate">{t.title}</span>
          {t.scheduleLabel && (
            <span className="shrink-0 text-xs text-ink-subtle">{t.scheduleLabel}</span>
          )}
          <span className="shrink-0 text-xs text-ink-faint">Adding…</span>
        </div>
      ))}

      {open ? (
        <div className="my-1.5">
          <AddTaskCard
            defaultDueYmd={dueYmd}
            host={host}
            lockDestination={lockDestination}
            onOptimisticAdd={(t) => setOptimistic((cur) => [...cur, t])}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-500 hover:text-neutral-300"
        >
          <span className="text-base leading-none text-[var(--accent)]">+</span> {label}
        </button>
      )}
    </>
  );
}
