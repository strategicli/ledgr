// Pure sort/compare for the Planner's Unscheduled rail (ADR-131 polish). The
// rail can hold a lot of tasks, so it offers a filter + a sort; the default
// "smart" order is priority, then most-recently-edited, then most-recently-
// created (Brandon's call). No DOM/React — node-testable; the rail component
// owns the filter input, the select, and paging.

export type RailSortKey = "smart" | "priority" | "edited" | "created" | "title";

export const RAIL_SORTS: { key: RailSortKey; label: string }[] = [
  { key: "smart", label: "Smart (priority · edited)" },
  { key: "priority", label: "Priority" },
  { key: "edited", label: "Recently edited" },
  { key: "created", label: "Recently created" },
  { key: "title", label: "Title A–Z" },
];

// Minimal shape the comparator needs — a ViewItem satisfies it.
export type RailItem = {
  urgency: number | null;
  updatedAt: Date;
  createdAt: Date;
  title: string;
};

// P1..P6 → 1..6; "no priority" (null, 0, or out of range) sorts last.
export function urgencyRank(u: number | null): number {
  return u == null || u < 1 || u > 6 ? 7 : u;
}

const byEditedDesc = (a: RailItem, b: RailItem) => b.updatedAt.getTime() - a.updatedAt.getTime();
const byCreatedDesc = (a: RailItem, b: RailItem) => b.createdAt.getTime() - a.createdAt.getTime();

// Total order for a sort key. "smart" = priority, then edited, then created
// (the default); ties always fall through to created so the order is stable.
export function compareRail(a: RailItem, b: RailItem, key: RailSortKey): number {
  switch (key) {
    case "title":
      return (a.title || "").localeCompare(b.title || "") || byEditedDesc(a, b);
    case "edited":
      return byEditedDesc(a, b) || byCreatedDesc(a, b);
    case "created":
      return byCreatedDesc(a, b);
    case "priority":
      return urgencyRank(a.urgency) - urgencyRank(b.urgency) || byEditedDesc(a, b) || byCreatedDesc(a, b);
    case "smart":
    default:
      return urgencyRank(a.urgency) - urgencyRank(b.urgency) || byEditedDesc(a, b) || byCreatedDesc(a, b);
  }
}

export const RAIL_PAGE = 25;
