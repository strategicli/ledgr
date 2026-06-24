// Shared class strings for the task-canvas right rail (ADR-108). Kept in a
// plain module (no "use client", no JSX) so the server TaskCanvas can import the
// row wrapper class while the client row components import the same trigger
// styling — one source of truth for the rail's vertical rhythm.

// One rail entry: a hairline divider above it, dropped on the first entry, so
// the rail reads as a clean divided list (the Todoist properties-panel rhythm).
export const RAIL_ROW = "border-t border-neutral-800/60 first:border-t-0";

// A popover row's trigger button: fills the row, label left / value right, with
// a gentle hover so it reads as tappable. Padding lives here (not the wrapper)
// so the whole padded row is the click target.
export const RAIL_TRIGGER =
  "group flex w-full items-center justify-between gap-3 rounded-md py-2.5 text-left text-sm outline-none transition-colors hover:bg-neutral-800/30 focus-visible:bg-neutral-800/40";

// Matching padding for static (non-popover) rows: status checkbox, focus, the
// relation/custom property groups.
export const RAIL_STATIC = "py-2.5";
