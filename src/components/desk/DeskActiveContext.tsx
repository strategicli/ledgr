// Live editing context for the Desk (ADR-162, wired here by ADR-167a). The Desk
// bypasses ItemCanvas, so nothing was reporting "what am I looking at" to the
// active_context row and Claude's get_active_context saw nothing while Brandon
// worked here.
//
// One tracker for the whole surface, not one per panel: however many items are
// open, only one panel holds the pen at a time (DeskTabset's focus-follows-
// click), so there is exactly one active item — the focused panel's active tab.
// Mounting a single instance and re-pointing it also means moving the pen is a
// prop change rather than an unmount/remount, so no DELETE from the departing
// panel can race the incoming report.
//
// Selections are read from `[data-desk-focused] [data-toc-scope]`, resolved
// fresh on each selection change, so a highlight only counts when it's in the
// panel that currently holds the pen. Since clicking a panel focuses it, a
// drag-select moves the marker before the selection lands.
"use client";

import ActiveContextTracker from "@/components/canvas/ActiveContextTracker";
import { findLeaf } from "@/lib/desk/layout";
import { useDesk } from "./DeskContext";
import { useDoc } from "./desk-doc-store";

const FOCUSED_PANEL_SCOPE = "[data-desk-focused] [data-toc-scope]";

export default function DeskActiveContext() {
  const { layout, focusedLeaf } = useDesk();
  const leaf = findLeaf(layout.root, focusedLeaf);
  const active = leaf?.tabs.find((t) => t.id === leaf.activeTab) ?? null;
  const itemId = active?.kind === "item" ? active.itemId : "";
  // Unconditional hook (empty id is a no-op in the store), so the focused tab
  // can flip between an item, a view, and a dashboard without breaking rules.
  const doc = useDoc(itemId);

  // A view/dashboard tab (or an empty panel) focused = no active item. The
  // tracker unmounts, which clears the row — correct: nothing is open.
  if (!itemId) return null;

  return (
    <ActiveContextTracker
      itemId={itemId}
      title={doc?.liveTitle?.trim() || doc?.title || ""}
      scopeSelector={FOCUSED_PANEL_SCOPE}
    />
  );
}
