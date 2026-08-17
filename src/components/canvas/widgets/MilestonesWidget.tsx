"use client";

// Milestones widget body (Project Type). Milestones are COMPLETABLE (ADR-196,
// reversing the original no-done-state semantic): each row carries the same
// completion circle as tasks (manual check), and the server also derives done
// from a linked task ("Completes with task") or — for dated milestones with no
// task link — from the date passing ("arrives whether you act or not", the
// surviving PRD §6 case, shown as "passed" rather than "done"). Dates are
// optional (Tyler, 2026-08-17): a work milestone without one simply shows no
// date. A milestone carrying an explicit `points` percent shows it as a chip —
// its share of the project bar. Adding is a "+ Milestone" that expands a
// compact title + optional date box (InlineContainAdd), Add/Cancel or Enter.
import { useEffect, useState } from "react";
import Link from "next/link";
import InlineContainAdd from "@/components/canvas/widgets/InlineContainAdd";
import TaskCheckCircle from "@/components/tasks/TaskCheckCircle";
import { onListRefreshFlush } from "@/lib/list-refresh";

type Row = {
  id: string;
  title: string;
  dueDate: string | null;
  done: boolean;
  via: "manual" | "task" | "date" | null;
  taskTitle: string | null;
  pct: number;
};

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MilestonesWidget({
  recordId,
  items,
}: {
  recordId: string;
  items: Row[];
}) {
  // Optimistic done state mirrored from the circle (same pattern as TasksWidget)
  // so the row styles the instant it's checked; the coalesced refresh re-syncs.
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  useEffect(() => onListRefreshFlush(() => setDoneOverride({})), []);

  // Open milestones first, then done; within each, by date ascending, undated
  // last (Tyler, 2026-07-01 order, done-sink added with completability).
  const sorted = [...items].sort((a, b) => {
    const ad = a.done ? 1 : 0;
    const bd = b.done ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (!a.dueDate) return b.dueDate ? 1 : 0;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5 empty:hidden">
        {sorted.map((m) => {
          const done = doneOverride[m.id] ?? m.done;
          // "passed" = date-derived completion (it arrived); a checked-off or
          // task-completed milestone reads "done"; anything else is upcoming.
          const badge = done
            ? m.via === "date" && doneOverride[m.id] === undefined
              ? { text: "passed", cls: "bg-neutral-800 text-neutral-500" }
              : { text: "done", cls: "bg-emerald-950/50 text-emerald-300" }
            : { text: "upcoming", cls: "bg-amber-950/50 text-amber-300" };
          return (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <TaskCheckCircle
                itemId={m.id}
                done={doneOverride[m.id] ?? m.via === "manual"}
                onOptimisticChange={(next) =>
                  setDoneOverride((cur) => ({ ...cur, [m.id]: next }))
                }
              />
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badge.cls}`}
                title={m.taskTitle ? `Completes with task: ${m.taskTitle}` : undefined}
              >
                {badge.text}
              </span>
              <Link
                href={`/items/${m.id}`}
                className={`min-w-0 flex-1 truncate hover:text-neutral-100 ${done ? "text-neutral-500 line-through" : "text-neutral-200"}`}
              >
                {m.title || "Untitled"}
              </Link>
              {m.pct > 0 && (
                <span
                  className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400"
                  title={`Worth ${m.pct}% of the project`}
                >
                  {m.pct}%
                </span>
              )}
              {m.dueDate && (
                <span className="shrink-0 text-xs text-neutral-500">{dayLabel(m.dueDate)}</span>
              )}
            </li>
          );
        })}
      </ul>
      <InlineContainAdd recordId={recordId} type="milestone" label="Milestone" />
    </div>
  );
}
