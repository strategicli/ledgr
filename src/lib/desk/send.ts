// Send-to-Desk helpers (ADR-146, S3/S3b). Rows and inline links live OUTSIDE the
// Desk, so these mutate the persisted per-device live layout (desk:layout) in
// localStorage directly, then the caller navigates to /desk, which reads it on
// mount. Two actions, one shared helper — used by RowMenu (S3) and by the inline
// mention/link context menu (S3b).
"use client";

import {
  addTab,
  freshLayout,
  findLeaf,
  itemTab,
  twoPanelLayout,
  type DeskTab,
} from "./layout";
import { loadLiveLayout, saveLiveLayout, snapshotToRecent } from "./persist";

// Fired after a send mutates desk:layout, so a DeskClient already mounted on
// /desk (the common case: you right-click a mention in a Desk preview twin)
// adopts the new layout instead of ignoring a same-route router.push.
export const DESK_LAYOUT_CHANGED_EVENT = "ledgr:desk-layout-changed";

function notifyLayoutChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DESK_LAYOUT_CHANGED_EVENT));
  }
}

// "Open in Desk": add the item as a tab in the focused panel of the current
// live layout (or a fresh desk). The rest of the desk is left intact.
export function sendOpenInDesk(itemId: string): void {
  const layout = loadLiveLayout() ?? freshLayout();
  saveLiveLayout(addTab(layout, layout.focusedLeaf, itemTab(itemId)));
  notifyLayoutChanged();
}

// The desk's current focused-panel item, if any — the left panel for an
// "Open beside" invoked without an explicit host item (e.g. from a list row).
function currentFocusedItemTabs(layout: ReturnType<typeof freshLayout>): DeskTab[] {
  const leaf = findLeaf(layout.root, layout.focusedLeaf);
  const active = leaf?.tabs.find((t) => t.id === leaf.activeTab);
  return active && active.kind === "item" ? [itemTab(active.itemId)] : [];
}

// "Open beside": replace the live layout with a two-panel layout — the current
// item on the left, the target on the right — snapshotting the OUTGOING layout
// to Recent first (never lose it). `currentItemId` (the host you're reading, for
// an inline link) wins; otherwise the desk's current focused item is used.
export function sendOpenBeside(itemId: string, currentItemId?: string): void {
  const layout = loadLiveLayout() ?? freshLayout();
  snapshotToRecent(layout);
  const leftTabs = currentItemId
    ? [itemTab(currentItemId)]
    : currentFocusedItemTabs(layout);
  saveLiveLayout(twoPanelLayout(leftTabs, [itemTab(itemId)]));
  notifyLayoutChanged();
}

// --- Inline context-menu event (S3b) --------------------------------------
// Inline references (mention chips in the editor, item links in the preview)
// dispatch this so the one globally-mounted DeskSendContextMenu opens at the
// cursor. Keeps the editor/preview from each owning a popover.
// The Desk is desktop-only: a fine pointer at ≥640px. Inline surfaces check this
// before intercepting a right-click, so touch/small screens keep native behavior.
export function deskSendAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(min-width: 640px)").matches &&
    !window.matchMedia("(pointer: coarse)").matches
  );
}

export const DESK_SEND_EVENT = "ledgr:desk-send";

export type DeskSendDetail = {
  itemId: string;
  currentItemId?: string;
  x: number;
  y: number;
};

export function openDeskSendMenu(detail: DeskSendDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DESK_SEND_EVENT, { detail }));
}
