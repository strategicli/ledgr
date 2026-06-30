// Per-item lens for related/linked lists: a small filter (title contains) plus
// a sort (field + direction) applied client-side to the already-fetched rows.
// Both the rule-driven "Open tasks" panel (MeetingPrep) and the generic "Linked
// here" panel (RelatedPanelClient) feed RelatedRows, so a list of 26 tasks gets
// the same sort/filter controls without a new query or round trip — the rows are
// already in memory (capped 500), so narrowing them is presentation, not data.
//
// The sort choice persists per host item in localStorage (same stance and
// mechanism as related-prefs.ts's "show completed": a tiny, single-user view
// preference that wants to be instant and remembered per item). The filter text
// is ephemeral local state, like any search box. Exposed as a useSyncExternal
// store hook so SSR and first paint agree on the passed default, then the
// persisted value takes over after mount.
import { useState, useSyncExternalStore } from "react";

export const RELATED_SORT_FIELDS = ["dueDate", "title", "updatedAt"] as const;
export type RelatedSortField = (typeof RELATED_SORT_FIELDS)[number];
export type RelatedSortDir = "asc" | "desc";
export type RelatedSort = { field: RelatedSortField; dir: RelatedSortDir };

export const RELATED_SORT_LABELS: Record<RelatedSortField, string> = {
  dueDate: "Due date",
  title: "Title",
  updatedAt: "Recently updated",
};

// Below this, the controls are clutter rather than help — keep short lists clean
// (the "idle list reserves no space" stance). Search/sort only earn their row
// once a list is long enough to be hard to scan.
export const RELATED_LENS_MIN_ROWS = 6;

// The minimum row shape the lens sorts/filters on — exactly what RelatedRowItem
// already carries, so callers pass their rows straight through.
export type RelatedLensRow = {
  title: string;
  dueDate: string | null; // ISO or null
  updatedAt: string; // ISO
};

// ---------------------------------------------------------------------------
// Persistence (per host item), mirroring related-prefs.ts.

const KEY = "ledgr.related.sort.v1";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function isSort(v: unknown): v is RelatedSort {
  return (
    !!v &&
    typeof v === "object" &&
    RELATED_SORT_FIELDS.includes((v as RelatedSort).field) &&
    ((v as RelatedSort).dir === "asc" || (v as RelatedSort).dir === "desc")
  );
}

// useSyncExternalStore compares snapshots with Object.is and treats a new
// reference as "the store changed". read() is called from getSnapshot, so it
// MUST return a stable reference while localStorage is unchanged — otherwise
// every render looks like a change, React loops, throws "getSnapshot should be
// cached", and unmounts the panel (and re-throws on the next mount, since the
// saved value is still there). Cache the parsed map keyed by the raw string;
// write() changes the string, so the next read re-parses exactly once.
let cachedRaw: string | null = null;
let cachedMap: Record<string, RelatedSort> = {};

function read(): Record<string, RelatedSort> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === cachedRaw) return cachedMap; // unchanged storage → same reference
    cachedRaw = raw;
    const obj = raw ? JSON.parse(raw) : {};
    cachedMap = obj && typeof obj === "object" ? (obj as Record<string, RelatedSort>) : {};
    return cachedMap;
  } catch {
    return {};
  }
}

function write(map: Record<string, RelatedSort>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota or privacy mode: a lost view preference is harmless */
  }
}

export function setRelatedSort(hostId: string, sort: RelatedSort): void {
  const map = read();
  map[hostId] = sort;
  write(map);
  emit();
}

// The stored sort for a host, or the caller's default when none is saved. The
// default is also the server snapshot, so first paint matches SSR.
export function useRelatedSort(hostId: string, fallback: RelatedSort): RelatedSort {
  return useSyncExternalStore(
    subscribe,
    () => {
      const v = read()[hostId];
      return isSort(v) ? v : fallback;
    },
    () => fallback
  );
}

// One-stop wiring for a list surface: the persisted sort (per host) plus an
// ephemeral filter query, and the applied result. Both panels use this so the
// behavior stays identical.
export function useRelatedLens<T extends RelatedLensRow>(
  hostId: string,
  rows: T[],
  fallback: RelatedSort
) {
  const sort = useRelatedSort(hostId, fallback);
  const [query, setQuery] = useState("");
  return {
    sort,
    setSort: (s: RelatedSort) => setRelatedSort(hostId, s),
    query,
    setQuery,
    visible: applyRelatedLens(rows, sort, query),
  };
}

// ---------------------------------------------------------------------------
// Pure transforms (testable, no React/DOM).

// Case-insensitive "title contains" filter. Empty/whitespace query is a no-op.
export function filterByQuery<T extends { title: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (r.title || "").toLowerCase().includes(q));
}

// Stable sort by the chosen field. Due dates sort nulls-last regardless of
// direction (an undated task is never "most due"), matching the view engine's
// "nulls last" rule. Title is a locale compare; updatedAt is an ISO compare.
export function sortRows<T extends RelatedLensRow>(rows: T[], sort: RelatedSort): T[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  const cmp = (a: T, b: T): number => {
    switch (sort.field) {
      case "title":
        return mul * (a.title || "").localeCompare(b.title || "");
      case "updatedAt":
        return mul * a.updatedAt.localeCompare(b.updatedAt);
      case "dueDate": {
        if (a.dueDate === b.dueDate) return 0;
        if (a.dueDate === null) return 1; // nulls last, both directions
        if (b.dueDate === null) return -1;
        return mul * a.dueDate.localeCompare(b.dueDate);
      }
    }
  };
  return [...rows].sort(cmp);
}

// Filter then sort, in one call.
export function applyRelatedLens<T extends RelatedLensRow>(
  rows: T[],
  sort: RelatedSort,
  query: string
): T[] {
  return sortRows(filterByQuery(rows, query), sort);
}
