// Shared state seam for the Desk's panel tree (ADR-146). DeskClient owns the
// single DeskLayout in React state and exposes it, the focused leaf, and the
// mutation actions through this context so any descendant (tabset, panel menu,
// move overlay) drives the tree without prop-drilling. Every action is a pure
// op from src/lib/desk/layout.ts applied via setLayout — the tree stays the one
// source of truth.
"use client";

import { createContext, useContext } from "react";
import type { DeskLayout, DropTarget } from "@/lib/desk/layout";

export type DeskActions = {
  focus: (leafId: string) => void;
  activate: (leafId: string, tabId: string) => void;
  openItem: (leafId: string, itemId: string) => void;
  // title is the view/dashboard's name, denormalized onto the tab at open time
  // (ADR-147 D2) so the strip shows the real name, not the literal kind word.
  openView: (leafId: string, viewId: string, title?: string) => void;
  openDashboard: (leafId: string, dashboardId: string, title?: string) => void;
  // Split a panel, duplicating its active tab into the new panel (the ⋯ menu's
  // "Split right/down"). An empty panel splits into another empty panel.
  splitActive: (leafId: string, dir: "row" | "col") => void;
  closeTab: (leafId: string, tabId: string) => void;
  closePanel: (leafId: string) => void;
  // Set the active canvas-section for an item tab (ADR-147 D5): per-panel, so two
  // panels of one item show different sections side by side.
  setSection: (leafId: string, tabId: string, section: number) => void;
  // Move a tab to a drop target (S2 zone move); center docks, an edge splits.
  moveTab: (fromLeafId: string, tabId: string, target: DropTarget) => void;
  // Record a divider drag back into the tree (a split's first-child fraction).
  setFrac: (splitId: string, frac: number) => void;
  // Arm/cancel the zone-move overlay (S2): while armed, every panel shows drop
  // zones; clicking one calls moveTab and disarms. Esc cancels.
  armMove: (fromLeafId: string, tabId: string) => void;
  cancelMove: () => void;
};

export type MoveArmed = { fromLeafId: string; tabId: string };

export type DeskContextValue = {
  layout: DeskLayout;
  focusedLeaf: string;
  // Set while a tab is armed for a zone move (the DeskMoveOverlay is showing).
  moveArmed: MoveArmed | null;
  actions: DeskActions;
};

const DeskContext = createContext<DeskContextValue | null>(null);

export const DeskProvider = DeskContext.Provider;

export function useDesk(): DeskContextValue {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk must be used within a DeskProvider");
  return ctx;
}
