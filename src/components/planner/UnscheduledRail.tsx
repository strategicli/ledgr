// The Planner's Unscheduled rail (ADR-131 polish): a filterable, sortable,
// paged list of tasks with no placement date, and a drop target that clears a
// task's date when something is dragged onto it. Shared by the month grid and
// the time-grid — each passes its own drop props and chip renderer (the drag
// wiring differs), the rail owns the filter box, the sort select, and "show
// more". Default sort is priority → recently edited → recently created.
"use client";

import { useMemo, useState } from "react";
import { compareRail, RAIL_PAGE, RAIL_SORTS, type RailSortKey } from "@/lib/planner-rail";
import type { ViewItem } from "@/components/views/ViewRenderer";

export default function UnscheduledRail({
  items,
  dropProps,
  highlight,
  renderChip,
}: {
  items: ViewItem[];
  // The parent's RAIL drop-target props (data-day + onDragOver/onDrop).
  dropProps: Record<string, unknown>;
  highlight: boolean;
  renderChip: (item: ViewItem) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<RailSortKey>("smart");
  const [limit, setLimit] = useState(RAIL_PAGE);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? items.filter((i) => (i.title || "").toLowerCase().includes(needle))
      : items;
    return [...base].sort((a, b) => compareRail(a, b, sort));
  }, [items, q, sort]);

  const shown = filtered.slice(0, limit);

  return (
    <aside
      {...dropProps}
      className={`flex shrink-0 flex-col rounded-lg border p-2 sm:w-56 ${
        highlight ? "border-[color:var(--accent)]" : "border-neutral-800"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Unscheduled
        </span>
        <span className="rounded-full bg-neutral-800 px-1.5 text-[11px] text-neutral-400">
          {filtered.length}
          {filtered.length !== items.length ? `/${items.length}` : ""}
        </span>
      </div>
      <div className="mb-2 flex flex-col gap-1">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(RAIL_PAGE);
          }}
          placeholder="Filter…"
          className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-[color:var(--accent)] focus:outline-none"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RailSortKey)}
          className="w-full rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 focus:border-[color:var(--accent)] focus:outline-none"
        >
          {RAIL_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex max-h-[60vh] flex-row flex-wrap gap-1 overflow-y-auto sm:flex-col sm:flex-nowrap">
        {shown.length === 0 ? (
          <p className="text-[11px] text-neutral-600">
            {items.length === 0 ? "Nothing waiting." : "No matches."}
          </p>
        ) : (
          // sm:shrink-0 keeps each chip its natural height in the column so the
          // rail SCROLLS past 60vh instead of squishing rows infinitely thin.
          shown.map((item) => (
            <div key={item.id} className="sm:shrink-0">
              {renderChip(item)}
            </div>
          ))
        )}
      </div>
      {filtered.length > limit && (
        <button
          onClick={() => setLimit((n) => n + RAIL_PAGE)}
          className="mt-2 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          Show {Math.min(RAIL_PAGE, filtered.length - limit)} more
        </button>
      )}
    </aside>
  );
}
