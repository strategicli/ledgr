// One panel of the Desk (ADR-146): a tab strip + the ⋯ panel menu + the active
// tab's content. Every leaf in the layout tree renders as one of these. The
// panel that's focused holds the pen — its active item mounts the real editor;
// clicking anywhere in a panel focuses it (focus follows click). Every control
// is labeled or tooltipped (scope-the-UI rule).
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DeskLeaf, DeskTab } from "@/lib/desk/layout";
import { useDesk } from "./DeskContext";
import { useDoc } from "./desk-doc-store";
import DeskItemPanel from "./DeskItemPanel";
import DeskMoveOverlay from "./DeskMoveOverlay";
import DeskOpenPicker from "./DeskOpenPicker";

export default function DeskTabset({ leaf }: { leaf: DeskLeaf }) {
  const { focusedLeaf, moveArmed, actions } = useDesk();
  const isFocused = focusedLeaf === leaf.id;
  // Manual "open another item" toggle. An empty panel always shows the picker
  // (derived below), so no effect is needed to sync it to the tab count.
  const [manualPick, setManualPick] = useState(false);
  const empty = leaf.tabs.length === 0;
  const picking = empty || manualPick;
  const active = leaf.tabs.find((t) => t.id === leaf.activeTab) ?? null;

  return (
    <div
      // First mousedown anywhere in the panel focuses it (moves the pen here),
      // before the editor handles the click.
      onMouseDownCapture={() => {
        if (!isFocused) actions.focus(leaf.id);
      }}
      className={`flex h-full min-h-0 min-w-0 flex-col bg-surface-0 ${
        isFocused ? "ring-1 ring-inset ring-accent/50" : ""
      }`}
    >
      <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-surface-1">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {leaf.tabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              active={tab.id === leaf.activeTab}
              onSelect={() => actions.activate(leaf.id, tab.id)}
              onClose={() => actions.closeTab(leaf.id, tab.id)}
            />
          ))}
          {leaf.tabs.length > 0 && (
            <button
              type="button"
              title="Open another item in this panel"
              aria-label="Open another item in this panel"
              onClick={() => setManualPick((p) => !p)}
              className="shrink-0 px-2 text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              +
            </button>
          )}
        </div>
        {active?.kind === "item" && (
          <span
            title={
              isFocused
                ? "This panel holds the pen — edits here save"
                : "Read-only preview; click to edit here"
            }
            className={`flex shrink-0 items-center px-2 text-[10px] font-semibold uppercase tracking-wide ${
              isFocused ? "text-emerald-400" : "text-ink-faint"
            }`}
          >
            {isFocused ? "Editing" : "Viewing"}
          </span>
        )}
        <PanelMenu leafId={leaf.id} active={active} />
      </div>

      <div className="relative min-h-0 flex-1">
        {picking && (
          <DeskOpenPicker
            hasTabs={!empty}
            onPick={(itemId) => {
              actions.openItem(leaf.id, itemId);
              setManualPick(false);
            }}
            onCancel={!empty ? () => setManualPick(false) : undefined}
          />
        )}
        {!picking && active?.kind === "item" && (
          <DeskItemPanel itemId={active.itemId} writer={isFocused} />
        )}
        {!picking && active?.kind === "view" && (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-subtle">
            View panels arrive in a later step.
          </div>
        )}
        {!picking && !active && (
          <div className="flex h-full items-center justify-center text-sm text-ink-subtle">
            Empty panel
          </div>
        )}
        {moveArmed && (
          <DeskMoveOverlay
            onZone={(zone) =>
              actions.moveTab(moveArmed.fromLeafId, moveArmed.tabId, {
                leafId: leaf.id,
                zone,
              })
            }
          />
        )}
      </div>
    </div>
  );
}

// One tab: its title (from the doc store for items) + a hover × to close.
function TabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: DeskTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const label = useTabLabel(tab);
  return (
    <div
      className={`group flex max-w-[14rem] shrink-0 items-center gap-1 border-r border-line px-3 text-sm ${
        active ? "bg-surface-0 text-ink" : "text-ink-muted hover:bg-surface-2"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="truncate py-1.5"
        title={label}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close tab"
        aria-label="Close tab"
        className="shrink-0 rounded px-1 text-ink-faint opacity-0 hover:bg-surface-3 hover:text-ink group-hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

function useTabLabel(tab: DeskTab): string {
  const doc = useDoc(tab.kind === "item" ? tab.itemId : "");
  if (tab.kind === "view") return "View";
  return doc?.liveTitle?.trim() || (doc?.status === "loading" ? "Loading…" : "Untitled");
}

// The ⋯ panel menu: split, open another item, open in full page, close panel.
function PanelMenu({ leafId, active }: { leafId: string; active: DeskTab | null }) {
  const { actions } = useDesk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fullPageHref =
    active?.kind === "item"
      ? `/items/${active.itemId}`
      : active?.kind === "view"
        ? `/views/${active.viewId}`
        : null;

  const itemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2";

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        title="Panel options"
        aria-label="Panel options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="px-2 text-ink-subtle hover:bg-surface-2 hover:text-ink"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 min-w-[12rem] rounded-card border border-line-strong bg-surface-3 p-1 shadow-2xl shadow-black/50"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              actions.splitActive(leafId, "row");
              setOpen(false);
            }}
          >
            ⇥ Split right
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              actions.splitActive(leafId, "col");
              setOpen(false);
            }}
          >
            ⤓ Split down
          </button>
          {active && (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                actions.armMove(leafId, active.id);
                setOpen(false);
              }}
            >
              ⤢ Move tab…
            </button>
          )}
          {fullPageHref && (
            <Link
              role="menuitem"
              href={fullPageHref}
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              ↗ Open in full page
            </Link>
          )}
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
            onClick={() => {
              actions.closePanel(leafId);
              setOpen(false);
            }}
          >
            ✕ Close panel
          </button>
        </div>
      )}
    </div>
  );
}
