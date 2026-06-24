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

// Side-rail widths, keyed by size. "hidden" leaves a sliver with the reopen
// tab; the others match the rendered rail width in NavShell. Expressed in rem
// (not px) so the whole nav scales with the interface-density setting: rem
// follows the root font-size that --ui-scale drives (globals.css), and the body
// clearance below reuses these exact values, so frame and clearance stay locked
// together at any density. (14rem/4rem/1.5rem == 224/64/24px at the 1.0 scale.)
export const RAIL_W: Record<RailSize, string> = {
  fat: "14rem",
  thin: "4rem",
  hidden: "1.5rem",
};

// Top-bar height (rem; 3.5rem == 56px at 1.0 scale). Both the spread
// (full-width) and compact (centered, 40rem) top bars dock flush at the top.
export const TOP_BAR_H = "3.5rem";
export const BOTTOM_CLEARANCE = "6rem";

// Width of the fixed Build-mode left sidebar (ADR-063; 15rem == 240px at 1.0
// scale). In Build mode this replaces the Work nav entirely, so the body clears
// it on the left regardless of the owner's chosen Work nav position. Desktop
// only — mobile Build uses a drawer over the content, no persistent clearance.
export const BUILD_SIDEBAR_W = "15rem";

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
      vars["--nav-pt"] = TOP_BAR_H;
      break;
    case "bottom":
      vars["--nav-pb"] = BOTTOM_CLEARANCE;
      break;
    case "left":
      vars["--nav-pl"] = RAIL_W[railSize];
      break;
    case "right":
      vars["--nav-pr"] = RAIL_W[railSize];
      break;
  }
  return vars as CSSProperties;
}
