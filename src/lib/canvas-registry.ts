// The per-type canvas seam (roadmap M5, ADR-041). A type may render through
// its own canvas component instead of the default markdown canvas — the
// platform hook the Songs/Papers modules need (a chord grid, a paper
// workspace; Tyler's PR #1). This is the *policy* half, kept pure (no
// component imports) so it resolves the same way on the server and in a verify
// script: it answers "which canvas id does this type use?", defaulting to the
// markdown canvas. The *wiring* half (canvas id -> React component) lives with
// the components in ItemCanvas, so this file never drags the editor bundle
// into a plain-node import.
//
// M6 turns the hardcoded map below into the module-registration boundary (a
// module contributes its own {type -> canvas}); until then the seam ships
// default-only plus one trivial proof (`link`), per the roadmap.
import type { ReactNode } from "react";
import type { getItem } from "@/lib/items";

// The loaded item a canvas renders. Derived from getItem so it can't drift
// from the real row shape.
export type CanvasItem = Awaited<ReturnType<typeof getItem>>;

// Every canvas — default or bespoke — receives the same context: the loaded,
// owner-checked, non-trashed item, its owner, and which surface it's on. A
// module canvas keys its own behavior off these (e.g. read-only on mobile).
export type CanvasProps = {
  item: CanvasItem;
  ownerId: string;
  variant: "page" | "modal";
};

// Canvases are server components (they do owner-scoped reads), so a canvas is
// just a function returning rendered output, sync or async.
export type CanvasComponent = (
  props: CanvasProps
) => ReactNode | Promise<ReactNode>;

// The default canvas: the markdown editor plus the type's standard panels.
// Anything not listed in CANVAS_BY_TYPE renders through this.
export const DEFAULT_CANVAS = "markdown";

// Types that declare a bespoke canvas (id -> resolved in the component
// wiring). Today only the trivial `link` proof exercises the seam; Songs,
// Papers, etc. join here via the M6 module-registration boundary.
const CANVAS_BY_TYPE: Record<string, string> = {
  link: "link",
};

export function canvasIdForType(type: string): string {
  return CANVAS_BY_TYPE[type] ?? DEFAULT_CANVAS;
}
