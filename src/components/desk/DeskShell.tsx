// Walks the DeskLayout tree into react-resizable-panels (ADR-146, hard-to-
// reverse decision #2: we own the tree, we rent the renderer). The library only
// draws splits and drag-resizes; every split node becomes a <PanelGroup> of two
// <Panel>s with a <PanelResizeHandle> between, and a leaf becomes a DeskTabset.
//
// We deliberately DON'T use the library's autoSaveId — the tree is the one
// persisted format (ours, versioned). Divider drags report through onLayout and
// we write the new fraction back into the tree via actions.setFrac, so there's a
// single source of truth and a future renderer swap touches only this file.
"use client";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { DeskNode, DeskSplit } from "@/lib/desk/layout";
import { useDesk } from "./DeskContext";
import DeskTabset from "./DeskTabset";

// Smallest a panel may shrink to (percent of its group). Keeps a panel from
// collapsing to an unusable sliver; the tree's frac clamp is the coarser guard.
const MIN_PANEL_PERCENT = 12;
// onLayout fires on mount too; ignore reports that don't actually move the
// divider so a remount can't thrash state.
const FRAC_EPSILON = 0.005;

export default function DeskShell() {
  const { layout } = useDesk();
  return (
    <div className="h-full w-full">
      <DeskNodeView node={layout.root} />
    </div>
  );
}

function DeskNodeView({ node }: { node: DeskNode }) {
  if (node.kind === "leaf") return <DeskTabset leaf={node} />;
  return <DeskSplitView split={node} />;
}

function DeskSplitView({ split }: { split: DeskSplit }) {
  const { actions } = useDesk();
  const horizontal = split.dir === "row";
  return (
    <PanelGroup
      // Key by the split id + both child ids so a structural change (a panel
      // added/closed, children swapped by a move) remounts cleanly and re-reads
      // defaultSize from the tree.
      key={`${split.id}:${split.a.id}:${split.b.id}`}
      direction={horizontal ? "horizontal" : "vertical"}
      className="h-full w-full"
      onLayout={(sizes) => {
        const first = sizes[0];
        if (first == null) return;
        const next = first / 100;
        if (Math.abs(next - split.frac) > FRAC_EPSILON) {
          actions.setFrac(split.id, next);
        }
      }}
    >
      <Panel defaultSize={split.frac * 100} minSize={MIN_PANEL_PERCENT} className="min-h-0 min-w-0">
        <DeskNodeView node={split.a} />
      </Panel>
      <PanelResizeHandle
        className={
          horizontal
            ? "relative w-[3px] bg-line transition-colors hover:bg-accent/60 data-[resize-handle-state=drag]:bg-accent"
            : "relative h-[3px] bg-line transition-colors hover:bg-accent/60 data-[resize-handle-state=drag]:bg-accent"
        }
      />
      <Panel defaultSize={(1 - split.frac) * 100} minSize={MIN_PANEL_PERCENT} className="min-h-0 min-w-0">
        <DeskNodeView node={split.b} />
      </Panel>
    </PanelGroup>
  );
}
