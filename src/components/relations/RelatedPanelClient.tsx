// Client shell for the Linked here panel (RelatedPanel does the server-side
// grouping; this owns the one bit of interactive state: whether completed rows
// show). Done rows are hidden by default — a related list should read as live
// work — with a per-item toggle in the section header that persists in
// localStorage (related-prefs.ts). All rows (done included) are sent down so
// the toggle is instant with no refetch; the counts here track what's visible.
"use client";

import { type ReactNode, useState } from "react";
import { setShowCompleted, useShowCompleted } from "@/lib/related-prefs";
import {
  RELATED_LENS_MIN_ROWS,
  filterByQuery,
  setRelatedSort,
  sortRows,
  useRelatedSort,
} from "@/lib/related-lens";
import CanvasSection from "@/components/canvas/CanvasSection";
import RelatedLensBar from "./RelatedLensBar";
import RelatedRow, { type RelatedRowItem } from "./RelatedRow";

export type RelatedRowDescriptor = {
  item: RelatedRowItem;
  suggested: boolean;
  mention: boolean;
  mentionOnly: boolean;
  removalRole?: string;
  done: boolean; // statusCategory === "done"
};

export type RelatedGroup = {
  key: string;
  header: ReactNode; // pre-rendered on the server (InlineLabel + type label)
  rows: RelatedRowDescriptor[];
};

export default function RelatedPanelClient({
  hostId,
  groups,
  addBar,
  bare,
}: {
  hostId: string;
  groups: RelatedGroup[];
  addBar: ReactNode;
  bare: boolean;
}) {
  // Default off so the panel reads as live work; the persisted per-item
  // preference takes over after mount (the store's server snapshot is off, so
  // SSR and first paint agree — no hydration mismatch).
  const showCompleted = useShowCompleted(hostId);
  // Lightweight lens: a title filter + a sort applied to the rows the panel
  // would already show. Default matches the server query's order (most recently
  // updated first). Grouping by type is preserved — the sort orders rows WITHIN
  // each type group, never across, so the type sections stay intact.
  const sort = useRelatedSort(hostId, { field: "updatedAt", dir: "desc" });
  const [query, setQuery] = useState("");

  const doneCount = groups.reduce(
    (n, g) => n + g.rows.filter((r) => r.done).length,
    0
  );

  // Step 1: drop completed unless revealed (existing behavior). This is the set
  // the lens (and its "of N" count) operates on.
  const liveGroups = groups.map((g) => ({
    ...g,
    rows: showCompleted ? g.rows : g.rows.filter((r) => !r.done),
  }));
  const liveCount = liveGroups.reduce((n, g) => n + g.rows.length, 0);

  // Step 2: apply the filter + sort per group; empty groups drop out (no header).
  const visibleGroups = liveGroups
    .map((g) => ({
      ...g,
      rows: sortRows(
        filterByQuery(
          g.rows.map((r) => ({ ...r, ...r.item })),
          query
        ),
        sort
      ),
    }))
    .filter((g) => g.rows.length > 0);

  const visibleCount = visibleGroups.reduce((n, g) => n + g.rows.length, 0);
  const filtered = query.trim().length > 0;

  // Only worth a toggle when something is actually hidden/hideable.
  const toggleBtn =
    doneCount > 0 ? (
      <button
        onClick={() => setShowCompleted(hostId, !showCompleted)}
        className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
      >
        {showCompleted ? "Hide completed" : `Show ${doneCount} completed`}
      </button>
    ) : null;

  const renderRow = (r: RelatedRowDescriptor) => (
    <RelatedRow
      key={r.item.id}
      hostId={hostId}
      item={r.item}
      suggested={r.suggested}
      mention={r.mention}
      mentionOnly={r.mentionOnly}
      removalRole={r.removalRole}
    />
  );

  return (
    <CanvasSection
      bare={bare}
      icon="affiliate"
      title="Linked here"
      count={liveCount}
      action={toggleBtn}
    >
      {liveCount >= RELATED_LENS_MIN_ROWS && (
        <RelatedLensBar
          sort={sort}
          onSortChange={(s) => setRelatedSort(hostId, s)}
          query={query}
          onQueryChange={setQuery}
          visibleCount={visibleCount}
          totalCount={liveCount}
        />
      )}
      {visibleGroups.map((g) => (
        <div key={g.key} className="mt-3 first:mt-0">
          <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {g.header}
            <span className="ml-2 font-normal text-neutral-600">{g.rows.length}</span>
          </h3>
          <ul className="mt-1">{g.rows.map(renderRow)}</ul>
        </div>
      ))}
      {/* Nothing to show: either the filter matched nothing, or everything is
          completed-and-now-hidden. Keep the panel present so the filter can be
          cleared / the toggle can bring rows back. */}
      {visibleGroups.length === 0 && (
        <p className="px-2 py-1 text-sm text-neutral-600">
          {filtered ? "No items match your filter." : "No open items linked here."}
        </p>
      )}
      <div className="mt-4">{addBar}</div>
    </CanvasSection>
  );
}
