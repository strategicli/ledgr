// Send-to-Desk helpers (ADR-146, S3/S3b). Rows and inline links live OUTSIDE the
// Desk, so these mutate the persisted per-device live layout (desk:layout) in
// localStorage directly, then the caller navigates to /desk, which reads it on
// mount. Two actions, one shared helper — used by RowMenu (S3) and by the inline
// mention/link context menu (S3b).
"use client";

import {
  addTab,
  appendColumn,
  dashboardTab,
  firstLeaf,
  freshLayout,
  itemTab,
  twoPanelLayout,
  viewTab,
  type DeskLayout,
  type DeskTab,
} from "./layout";
import { loadLiveLayout, saveLiveLayout, snapshotToRecent } from "./persist";

// The surface an "Open beside" is anchored to (ADR-147 D1): the list/view/
// dashboard whose row you invoked it from (or, for an inline reference, the item
// you're reading). Threaded down from the host page via DeskHostContext, or
// passed explicitly for the inline-mention path. `null` = no anchor available (a
// bare type-list sort with no reusable view id), which degrades to opening the
// item alone.
export type DeskHost =
  | { kind: "view"; viewId: string; title?: string }
  | { kind: "dashboard"; dashboardId: string; title?: string }
  | { kind: "item"; itemId: string; title?: string };

// The DeskTab that anchors a host's left column.
function hostTab(host: DeskHost): DeskTab {
  if (host.kind === "view") return viewTab(host.viewId, host.title);
  if (host.kind === "dashboard") return dashboardTab(host.dashboardId, host.title);
  return itemTab(host.itemId);
}

// Whether the live layout's leftmost panel already leads with this host — the
// signal that a repeat "Open beside this <host>" should APPEND a column rather
// than rebuild the layout from scratch (ADR-147 D1).
function anchoredOn(layout: DeskLayout, host: DeskHost): boolean {
  const lead = firstLeaf(layout.root).tabs[0];
  if (!lead) return false;
  if (host.kind === "view") return lead.kind === "view" && lead.viewId === host.viewId;
  if (host.kind === "dashboard")
    return lead.kind === "dashboard" && lead.dashboardId === host.dashboardId;
  return lead.kind === "item" && lead.itemId === host.itemId;
}

// Fired after a send mutates desk:layout, so a DeskClient already mounted on
// /desk (the common case: you right-click a mention in a Desk preview twin)
// adopts the new layout instead of ignoring a same-route router.push.
export const DESK_LAYOUT_CHANGED_EVENT = "ledgr:desk-layout-changed";

function notifyLayoutChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DESK_LAYOUT_CHANGED_EVENT));
  }
}

// "Send to Desk": add the item as a tab in the focused panel of the current
// live layout (or a fresh desk). The rest of the desk is left intact.
export function sendOpenInDesk(itemId: string): void {
  const layout = loadLiveLayout() ?? freshLayout();
  saveLiveLayout(addTab(layout, layout.focusedLeaf, itemTab(itemId)));
  notifyLayoutChanged();
}

// "Open beside this <host>" (ADR-147 D1): put the host surface you invoked from
// (a saved view, a dashboard, or the item you're reading) as the LEFT column and
// the clicked item to its right. First invocation seeds `[host | target]`,
// snapshotting the outgoing layout to Recent first (never lost). A REPEAT from
// the same host — the leftmost panel already leads with it — instead APPENDS a
// new rightmost column, growing `[host | A | B]` without disturbing what's there
// (no snapshot: we're extending, not replacing). With no host (a bare type list
// with no reusable view id), it degrades to opening the item alone.
export function sendOpenBeside(itemId: string, host: DeskHost | null): void {
  const layout = loadLiveLayout() ?? freshLayout();
  if (!host) {
    saveLiveLayout(addTab(layout, layout.focusedLeaf, itemTab(itemId)));
    notifyLayoutChanged();
    return;
  }
  if (anchoredOn(layout, host)) {
    saveLiveLayout(appendColumn(layout, [itemTab(itemId)]).layout);
  } else {
    snapshotToRecent(layout);
    saveLiveLayout(twoPanelLayout([hostTab(host)], [itemTab(itemId)]));
  }
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
