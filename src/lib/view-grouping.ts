// Pure grouping helpers for the board layout (slice 35, PRD §4.2/§4.14),
// extracted from ViewRenderer so the logic is node-testable — the renderer is a
// React component, but a board column's value + order is plain policy. Same
// pure-policy-vs-wiring split as canvas-registry/modules.ts.
//
// The new capability: a board can group by a custom *select* property (a
// workflow's "Stage"), not just the built-in fields. Property values live in
// items.properties; the column order follows the property's options when known.
import { ITEM_STATUSES, URGENCIES } from "@/lib/item-enums";
import type { GroupField, ViewGrouping } from "@/lib/views";

// The fields a board needs to compute a row's group. A superset-narrowing of a
// listColumns row (the renderer passes the same rows it already has).
// properties is unknown (jsonb), cast once where it's read below.
export type GroupableItem = {
  status: string;
  urgency: string | null;
  type: string;
  dueDate: Date | null;
  scheduledDate: Date | null;
  properties: unknown;
};

export const NONE_GROUP = "none";
const DUE_ORDER = ["overdue", "today", "this week", "later", "no date"] as const;

// en-CA renders YYYY-MM-DD, a sortable day key; due dates are UTC-midnight
// calendar days (ADR-008), so compare in UTC.
const utcKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });

export function dueBucket(dueDate: Date | null, now: Date): string {
  if (!dueDate) return "no date";
  const today = utcKey.format(now);
  const itemKey = utcKey.format(dueDate);
  if (itemKey < today) return "overdue";
  if (itemKey === today) return "today";
  const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (itemKey <= utcKey.format(week)) return "this week";
  return "later";
}

// The board column a row falls in. A property grouping reads items.properties:
// a missing/empty value is NONE_GROUP; an array (multi_select) joins its values
// so a row shows under its combined membership (kept simple — no fan-out).
export function groupValueFor(
  item: GroupableItem,
  grouping: ViewGrouping,
  now: Date
): string {
  if (grouping && "propertyKey" in grouping) {
    const props = item.properties as Record<string, unknown> | null;
    const v = props?.[grouping.propertyKey];
    if (v == null || v === "") return NONE_GROUP;
    if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : NONE_GROUP;
    return String(v);
  }
  const field: GroupField = grouping?.field ?? "status";
  switch (field) {
    case "status":
      return item.status;
    case "urgency":
      return item.urgency ?? NONE_GROUP;
    case "type":
      return item.type;
    case "due":
      return dueBucket(item.dueDate, now);
    case "scheduled":
      return dueBucket(item.scheduledDate, now);
  }
}

// The /api/items PATCH body that moves a card into board column `col`, given
// the grouping (board DnD, the kanban drop). Only the groupings the board lets
// you drag — a status/urgency field, or a single-select property — are
// expressible; anything else (computed `due`, `type`, multi_select) returns
// null and the drop is a no-op. The page gates which boards drag; this is the
// backstop + the single place the drop→write mapping lives. NONE_GROUP clears.
export function boardDropPatch(
  grouping: ViewGrouping,
  col: string
): Record<string, unknown> | null {
  if (grouping && "propertyKey" in grouping) {
    return {
      propertyPatch: { [grouping.propertyKey]: col === NONE_GROUP ? null : col },
    };
  }
  const field: GroupField = grouping?.field ?? "status";
  if (field === "status") return { status: col };
  if (field === "urgency") return { urgency: col === NONE_GROUP ? null : col };
  return null;
}

// Column order: a known order first (the enum's canonical order for a built-in
// field, or the property's option order for a property grouping), then any
// remaining present values alphabetically, with NONE_GROUP always last.
export function orderedGroups(
  grouping: ViewGrouping,
  present: Set<string>,
  knownOrder?: string[]
): string[] {
  let known: readonly string[] = [];
  if (grouping && "propertyKey" in grouping) {
    known = knownOrder ?? [];
  } else {
    const field: GroupField = grouping?.field ?? "status";
    // status uses the type's resolved status keys (knownOrder) so a board shows
    // every custom status as a column in schema order (S2); ITEM_STATUSES is the
    // inherited-default fallback.
    known = {
      status: knownOrder ?? ITEM_STATUSES,
      urgency: [...URGENCIES, NONE_GROUP],
      due: DUE_ORDER,
      scheduled: DUE_ORDER,
      type: [] as readonly string[],
    }[field];
  }
  const head = known.filter((v) => present.has(v));
  const rest = [...present]
    .filter((v) => !head.includes(v))
    .sort((a, b) =>
      a === NONE_GROUP ? 1 : b === NONE_GROUP ? -1 : a.localeCompare(b)
    );
  return [...head, ...rest];
}
