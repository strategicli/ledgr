// Status/urgency value lists, split out of items.ts so client components
// (the canvas field strip) can import them without dragging the DB layer
// into the browser bundle. items.ts re-exports these; server code keeps
// importing from there.
//
// Statuses are now user-defined per type (Tasks Polish S2, src/lib/status.ts):
// a status is a free-text KEY mapped to a fixed category. ITEM_STATUSES is only
// the inherited *default* set's keys (open/done/archived) — a generic fallback
// list; real status options come from a type's resolved schema. So ItemStatus is
// a string (a status key), no longer a closed union, and the list is typed
// readonly string[] so membership checks accept any key.
export const ITEM_STATUSES: readonly string[] = ["open", "done", "archived"];
export const URGENCIES = ["low", "normal", "high", "critical"] as const;
export type ItemStatus = string;
export type Urgency = (typeof URGENCIES)[number];
