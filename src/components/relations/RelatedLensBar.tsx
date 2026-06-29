// Compact filter + sort bar for a related/linked list (the lightweight "lens"
// for these in-canvas lists; ADR pending). Controlled: the parent owns the sort
// (persisted per host via related-lens.ts) and the filter query, so the same bar
// drops onto the rule-driven "Open tasks" panel and the generic "Linked here"
// panel. Every control is labeled (Brandon's "scope the UI" rule) — a search
// box with placeholder, a labeled Sort select, and a direction toggle whose
// title spells out what it does.
"use client";

import {
  RELATED_SORT_FIELDS,
  RELATED_SORT_LABELS,
  type RelatedSort,
} from "@/lib/related-lens";

export default function RelatedLensBar({
  sort,
  onSortChange,
  query,
  onQueryChange,
  visibleCount,
  totalCount,
}: {
  sort: RelatedSort;
  onSortChange: (s: RelatedSort) => void;
  query: string;
  onQueryChange: (q: string) => void;
  visibleCount: number;
  totalCount: number;
}) {
  const filtered = query.trim().length > 0 && visibleCount !== totalCount;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-xs text-neutral-500">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Filter by title…"
        aria-label="Filter list by title"
        className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
      />
      <label className="flex shrink-0 items-center gap-1">
        <span className="text-neutral-600">Sort</span>
        <select
          value={sort.field}
          onChange={(e) =>
            onSortChange({ ...sort, field: e.target.value as RelatedSort["field"] })
          }
          aria-label="Sort field"
          className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-neutral-200 focus:border-neutral-500 focus:outline-none"
        >
          {RELATED_SORT_FIELDS.map((f) => (
            <option key={f} value={f}>
              {RELATED_SORT_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onSortChange({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
        title={sort.dir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
        aria-label={`Sort direction: ${sort.dir === "asc" ? "ascending" : "descending"}`}
        className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
      >
        {sort.dir === "asc" ? "↑" : "↓"}
      </button>
      {filtered && (
        <span className="shrink-0 text-neutral-600">
          {visibleCount} of {totalCount}
        </span>
      )}
    </div>
  );
}
