// The Desk (ADR-146): a desktop-only, client-rendered workspace at /desk where
// items open side by side in resizable, tabbed panels, and the arrangement
// survives closing the app. This top-level client component owns the single
// DeskLayout, persists it per-device (localStorage), gates the surface at 640px
// (below it a plain list of open tabs), and exposes the mutation actions.
//
// The layout is client state, never in the URL (hard-to-reverse decision #4):
// existing routes keep their deep-linkable URLs; the Desk arrangement lives in
// app state like VS Code / Obsidian / Logos.
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useIsDesktop } from "@/components/markdown-editor/useIsDesktop";
import {
  addTab,
  allTabs,
  closeLeaf,
  closeTab,
  findLeaf,
  focusLeaf,
  freshLayout,
  itemTab,
  moveTab,
  setActiveTab,
  setFrac,
  splitLeaf,
  viewTab,
  type DeskLayout,
} from "@/lib/desk/layout";
import { loadLiveLayout, saveLiveLayout } from "@/lib/desk/persist";
import { DeskProvider, type DeskActions } from "./DeskContext";
import DeskShell from "./DeskShell";
import { useDoc } from "./desk-doc-store";

const SAVE_DEBOUNCE_MS = 400;

// `false` during SSR and the first (hydration) client paint, then `true` —
// without an effect, so it complies with the no-setState-in-effect rule. The
// first client render therefore matches the server (chrome only), avoiding a
// hydration mismatch before the localStorage-loaded layout paints.
const noop = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
}

export default function DeskClient() {
  const isDesktop = useIsDesktop();
  const mounted = useMounted();
  // Lazily loaded from the per-device store; `window` is absent during SSR, so
  // the server falls back to a fresh desk (never rendered — the `mounted` gate
  // shows chrome only until the client takes over).
  const [layout, setLayout] = useState<DeskLayout>(() =>
    typeof window === "undefined" ? freshLayout() : loadLiveLayout() ?? freshLayout()
  );

  // Debounced per-device autosave of the live layout.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!mounted) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveLiveLayout(layout), SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [layout, mounted]);

  const actions = useMemo<DeskActions>(
    () => ({
      focus: (leafId) => setLayout((l) => focusLeaf(l, leafId)),
      activate: (leafId, tabId) => setLayout((l) => setActiveTab(l, leafId, tabId)),
      openItem: (leafId, itemId) =>
        setLayout((l) => addTab(l, leafId, itemTab(itemId))),
      splitActive: (leafId, dir) =>
        setLayout((l) => {
          const leaf = findLeaf(l.root, leafId);
          const active = leaf?.tabs.find((t) => t.id === leaf.activeTab) ?? null;
          // Duplicate the active tab into the new panel (a fresh tab id pointing
          // at the same item/view); an empty panel splits into another empty one.
          const dup = active
            ? active.kind === "item"
              ? [itemTab(active.itemId)]
              : [viewTab(active.viewId)]
            : [];
          return splitLeaf(l, leafId, dir, dup, false).layout;
        }),
      closeTab: (leafId, tabId) => setLayout((l) => closeTab(l, leafId, tabId)),
      closePanel: (leafId) => setLayout((l) => closeLeaf(l, leafId)),
      moveTab: (fromLeafId, tabId, target) =>
        setLayout((l) => moveTab(l, fromLeafId, tabId, target)),
      setFrac: (splitId, frac) => setLayout((l) => setFrac(l, splitId, frac)),
    }),
    []
  );

  // Pre-mount: render the chrome only, so SSR and the first client paint agree.
  if (!mounted) {
    return (
      <div className="flex h-[100dvh] flex-col bg-surface-0">
        <DeskTopBar />
        <div className="flex-1" />
      </div>
    );
  }

  // Desktop-only surface. Below 640px the panels degrade to a plain list of the
  // open tabs, each linking to its full-page canvas (Desk editing is desktop).
  if (!isDesktop) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-surface-0">
        <DeskTopBar />
        <DeskMobileList layout={layout} />
      </div>
    );
  }

  return (
    <DeskProvider value={{ layout, focusedLeaf: layout.focusedLeaf, actions }}>
      <div className="flex h-[100dvh] flex-col bg-surface-0">
        <DeskTopBar />
        <div className="min-h-0 flex-1">
          <DeskShell />
        </div>
      </div>
    </DeskProvider>
  );
}

// The top bar. For S1 it's just the surface name; the workspaces pill (named +
// Recent) lands on the right in S2.
function DeskTopBar() {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-4">
      <div className="flex items-center gap-2">
        <span className="ui-section-label text-ink-muted">Desk</span>
      </div>
      <div className="flex items-center gap-2">
        {/* Workspaces menu (named + Recent) mounts here in S2. */}
      </div>
    </header>
  );
}

// The < 640px fallback: a plain, scrollable list of every open tab. Desk editing
// is desktop-only, so each row opens the item's normal full-page canvas.
function DeskMobileList({ layout }: { layout: DeskLayout }) {
  const tabs = allTabs(layout);
  if (tabs.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-ink-subtle">
        The Desk is a desktop workspace. Nothing is open yet — open items on a
        wider screen to arrange them here.
      </div>
    );
  }
  return (
    <div className="px-3 py-3">
      <p className="ui-meta mb-2 px-1 text-ink-subtle">
        The Desk is desktop-only. Your open items:
      </p>
      <ul className="flex flex-col gap-1">
        {tabs.map((t) =>
          t.kind === "item" ? (
            <MobileItemRow key={t.id} itemId={t.itemId} />
          ) : (
            <li key={t.id}>
              <Link
                href={`/views/${t.viewId}`}
                className="block rounded-card border border-line bg-surface-1 px-3 py-2 text-sm text-ink hover:bg-surface-2"
              >
                View
              </Link>
            </li>
          )
        )}
      </ul>
    </div>
  );
}

function MobileItemRow({ itemId }: { itemId: string }) {
  const doc = useDoc(itemId);
  const title = doc?.liveTitle?.trim() || "Untitled";
  return (
    <li>
      <Link
        href={`/items/${itemId}`}
        className="block rounded-card border border-line bg-surface-1 px-3 py-2 text-sm text-ink hover:bg-surface-2"
      >
        {title}
      </Link>
    </li>
  );
}
