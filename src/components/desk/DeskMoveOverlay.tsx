// The zone-move overlay (ADR-146, S2). Armed from a panel's ⋯ menu ("Move
// tab…"), it covers every panel with five drop zones: center docks the moving
// tab here as a tab; an edge splits this panel and places the tab in the new
// half. Click-to-place (no drag gesture in v1); Esc cancels (handled in
// DeskClient). The zones speak the same DropTarget vocabulary a future drag
// gesture would. Every zone is labeled (scope-the-UI rule).
"use client";

import type { DropZone } from "@/lib/desk/layout";

// The proportion of the panel each edge strip claims; the center fills the rest.
const EDGE = "28%";

export default function DeskMoveOverlay({
  onZone,
}: {
  onZone: (zone: DropZone) => void;
}) {
  const zoneClass =
    "absolute flex items-center justify-center rounded-md border border-dashed border-accent/70 bg-accent/5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20";
  return (
    <div className="absolute inset-0 z-40 bg-surface-0/40 p-1">
      <button
        type="button"
        aria-label="Split left"
        title="Split left"
        onClick={() => onZone("left")}
        className={zoneClass}
        style={{ left: 4, top: EDGE, bottom: EDGE, width: `calc(${EDGE} - 4px)` }}
      >
        Split
      </button>
      <button
        type="button"
        aria-label="Split right"
        title="Split right"
        onClick={() => onZone("right")}
        className={zoneClass}
        style={{ right: 4, top: EDGE, bottom: EDGE, width: `calc(${EDGE} - 4px)` }}
      >
        Split
      </button>
      <button
        type="button"
        aria-label="Split up"
        title="Split up"
        onClick={() => onZone("top")}
        className={zoneClass}
        style={{ top: 4, left: EDGE, right: EDGE, height: `calc(${EDGE} - 4px)` }}
      >
        Split
      </button>
      <button
        type="button"
        aria-label="Split down"
        title="Split down"
        onClick={() => onZone("bottom")}
        className={zoneClass}
        style={{ bottom: 4, left: EDGE, right: EDGE, height: `calc(${EDGE} - 4px)` }}
      >
        Split
      </button>
      <button
        type="button"
        aria-label="Add as a tab in this panel"
        title="Add as a tab in this panel"
        onClick={() => onZone("center")}
        className={zoneClass}
        style={{ top: EDGE, bottom: EDGE, left: EDGE, right: EDGE }}
      >
        Add as tab
      </button>
    </div>
  );
}
