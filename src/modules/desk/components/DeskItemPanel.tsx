// An item shown in a Desk panel (ADR-146, revised by ADR-165). Every panel that
// shows an item mounts the SAME real editor (ItemEditor, editable, toolbar on),
// keyed by item so moving the pen between panels never remounts it — no swap, no
// reformat, no flash, and a click lands the caret natively between the exact
// characters clicked. The focused panel is the "source": its edits publish to the
// doc store and save. Every other panel is a "follower": it applies the source's
// live text in place (setContent, emitUpdate:false) and never saves. Only one
// keyboard exists, so only one panel is ever the source at a time — two editors on
// one item can't physically race, which is why the old "one mounted editor" rule
// (ADR-146) could be relaxed.
"use client";

import FloatingToc from "@/components/canvas/FloatingToc";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import { tocForType } from "@/lib/toc";
import { useDesk } from "./DeskContext";
import ItemDetails from "./ItemDetails";
import { publishLive, seedForEditor, useDoc, useTabsEnabled } from "./desk-doc-store";

export default function DeskItemPanel({
  itemId,
  writer,
  section,
  showDetails,
}: {
  itemId: string;
  writer: boolean;
  // The active canvas-section for this tab in this panel (ADR-147 D5). Each panel
  // controls its own TabbedBody with it, source or follower alike.
  section: number;
  // Whether this tab shows the properties/relations/"Linked here" panel below
  // the body (ADR-147 D6). Editable only in the focused panel.
  showDetails: boolean;
}) {
  const doc = useDoc(itemId);
  // Canvas-tabs enablement (ADR-147 D4): drives whether the body edits as tabs.
  // Hook is called unconditionally, before the early returns below.
  const tabsEnabled = useTabsEnabled(doc?.type);
  // Table of contents (ADR-167). Same resolution ItemCanvas does server-side,
  // from the settings the Desk shell carried into context.
  const { tocByType, tocPinnedItems } = useDesk();
  const toc = tocForType({ tocByType }, doc?.type ?? "");

  if (!doc || doc.status === "loading") return <PanelMessage>Loading…</PanelMessage>;
  if (doc.status === "error")
    return <PanelMessage>Couldn’t load this item.</PanelMessage>;

  // The editor's content, taken from the store's live state so a follower reflects
  // the source's edits as they land (the seed object changes each publish, and the
  // follower applies it in place). Both panels seed from the same place.
  const seed = seedForEditor(itemId);
  if (!seed) return <PanelMessage>Loading…</PanelMessage>;

  return (
    // This div is both the panel's scroll container and the outline's scope, so
    // the sticky ToC layer pins against THIS panel — which is the whole reason
    // the outline can exist in a multi-panel Desk at all (ADR-167). --nav-pt is
    // zeroed for the same reason Modal.tsx zeroes it: the panel is its own
    // scroll context with no page header above it to clear.
    <div
      data-toc-scope
      className="h-full overflow-auto"
      style={{ "--nav-pt": "0px" } as React.CSSProperties}
    >
      {toc.enabled && (
        // First child: a sticky box only pins while its containing block is in
        // view, so mounting it after the editor would strand it at the bottom.
        <FloatingToc
          itemId={itemId}
          levels={toc.levels}
          pinned={tocPinnedItems.includes(itemId)}
        />
      )}
      <ItemEditor
        // Keyed by item, NOT by focus: the editor stays mounted as the pen moves
        // between panels, so the source↔follower flip is just a prop change — no
        // remount, no reformat, no flash.
        key={itemId}
        item={seed}
        tabsEnabled={tabsEnabled}
        controlledSection={tabsEnabled ? section : undefined}
        // Non-focused panels follow the source's live text instead of editing.
        follower={!writer}
        onLiveChange={(next) => publishLive(itemId, next)}
      />
      {showDetails && (
        // Distinct key from the sibling editor (which is keyed by itemId); keying
        // by item still gives a fresh mount + refetch when the item changes.
        <ItemDetails key={`details-${itemId}`} itemId={itemId} writer={writer} />
      )}
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-subtle">
      {children}
    </div>
  );
}
