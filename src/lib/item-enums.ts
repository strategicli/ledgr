// Status/priority value lists, split out of items.ts so client components
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
export type ItemStatus = string;

// Priority P1–P6 (ADR-096) replaced the old 4-level `urgency` enum. The vocab,
// colors, and helpers live in src/lib/priority.ts. The names `Urgency`/
// `URGENCIES` are kept as aliases (the column stays named `urgency` internally,
// surfaced as "Priority"), so existing imports keep resolving.
export { PRIORITIES, PRIORITIES as URGENCIES, type Priority } from "@/lib/priority";
// `Urgency` = the stored priority value as it comes off the column: a number
// (1..6), or whatever's there. The validated 1..6 union is `Priority`; coerce
// with `toPriority` at write/display time. Keeping `Urgency` loose (number)
// avoids friction with drizzle's inferred `number | null` column type.
export type Urgency = number;
