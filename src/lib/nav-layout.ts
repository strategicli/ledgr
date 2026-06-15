// Shared geometry for the nav chrome (v6). The body has to clear whatever edge
// the nav docks to, and that clearance must match the nav's own size exactly.
// Both the server layout (initial paint, no-JS) and the client NavShell (instant
// updates when the rail collapses) read these, so the numbers live in one place.
//
// The values are written as CSS custom properties on <body>; globals.css applies
// them as padding at the sm+ breakpoint only (mobile always uses the bottom bar,
// so it gets a fixed bottom clearance regardless of the chosen position).
import type { CSSProperties } from "react";
import type { NavPosition, RailSize } from "@/lib/settings";

// Side-rail widths in pixels, keyed by size. "hidden" leaves a sliver with the
// reopen tab; the others match the rendered rail width in NavShell.
export const RAIL_PX: Record<RailSize, number> = {
  fat: 224,
  thin: 64,
  hidden: 24,
};

// Top-bar height (px). Both the spread (full-width) and compact (centered,
// 40rem) top bars are docked flush at the top edge at this height.
export const TOP_BAR_PX = 56;
export const BOTTOM_CLEARANCE = "6rem";

// The four padding vars for a given position + rail size. NavShell mutates just
// the relevant one on collapse; the layout sets all four for the first paint.
export function navPadVars(
  position: NavPosition,
  railSize: RailSize
): CSSProperties {
  const vars: Record<string, string> = {
    "--nav-pt": "0px",
    "--nav-pb": "0px",
    "--nav-pl": "0px",
    "--nav-pr": "0px",
  };
  switch (position) {
    case "top":
      vars["--nav-pt"] = `${TOP_BAR_PX}px`;
      break;
    case "bottom":
      vars["--nav-pb"] = BOTTOM_CLEARANCE;
      break;
    case "left":
      vars["--nav-pl"] = `${RAIL_PX[railSize]}px`;
      break;
    case "right":
      vars["--nav-pr"] = `${RAIL_PX[railSize]}px`;
      break;
  }
  return vars as CSSProperties;
}
