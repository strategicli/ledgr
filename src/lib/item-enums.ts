// Status/urgency value lists, split out of items.ts so client components
// (the canvas field strip) can import them without dragging the DB layer
// into the browser bundle. items.ts re-exports these; server code keeps
// importing from there.
export const ITEM_STATUSES = ["open", "done", "archived"] as const;
export const URGENCIES = ["low", "normal", "high", "critical"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type Urgency = (typeof URGENCIES)[number];
