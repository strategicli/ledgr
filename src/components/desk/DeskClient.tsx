// The Desk (ADR-146): a desktop-only, client-rendered workspace at /desk where
// items open side by side in resizable, tabbed panels, and the arrangement
// survives closing the app. This top-level client component owns the single
// DeskLayout, persists it per-device (localStorage), gates the surface at 640px
// (below it a plain list of open tabs), and exposes the mutation actions.
//
// It also owns the two "never lose a layout" mechanisms (S2): the Recent
// auto-snapshot ring (per device) and named workspaces (synced via
// users.settings). Loading anything that replaces the live layout snapshots the
// outgoing one to Recent first.
//
// The layout is client state, never in the URL (hard-to-reverse decision #4):
// existing routes keep their deep-linkable URLs; the Desk arrangement lives in
// app state like VS Code / Obsidian / Logos.
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useIsDesktop } from "@/components/markdown-editor/useIsDesktop";
import { showToast } from "@/components/ui/ActionToast";
import {
  addTab,
  allTabs,
  closeLeaf,
  closeTab,
  dashboardTab,
  findLeaf,
  focusLeaf,
  freshLayout,
  itemTab,
  moveTab,
  setActiveTab,
  setFrac,
  setTabSection,
  splitLeaf,
  viewTab,
  type DeskLayout,
} from "@/lib/desk/layout";
import {
  loadLiveLayout,
  loadRecent,
  saveLiveLayout,
  snapshotToRecent,
  type RecentSnapshot,
} from "@/lib/desk/persist";
import { DESK_LAYOUT_CHANGED_EVENT } from "@/lib/desk/send";
import type { DeskWorkspace } from "@/lib/settings";
import { DeskProvider, type DeskActions, type MoveArmed } from "./DeskContext";
import DeskShell from "./DeskShell";
import DeskWorkspacesMenu from "./DeskWorkspacesMenu";
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

function newWorkspaceId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function DeskClient({
  initialWorkspaces,
}: {
  initialWorkspaces: DeskWorkspace[];
}) {
  const isDesktop = useIsDesktop();
  const mounted = useMounted();
  // Lazily loaded from the per-device store; `window` is absent during SSR, so
  // the server falls back to a fresh desk (never rendered — the `mounted` gate
  // shows chrome only until the client takes over).
  const [layout, setLayout] = useState<DeskLayout>(() =>
    typeof window === "undefined" ? freshLayout() : loadLiveLayout() ?? freshLayout()
  );
  const [moveArmed, setMoveArmed] = useState<MoveArmed | null>(null);
  const [workspaces, setWorkspaces] = useState<DeskWorkspace[]>(initialWorkspaces);
  const [recent, setRecent] = useState<RecentSnapshot[]>(() =>
    typeof window === "undefined" ? [] : loadRecent()
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

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

  // A Send-to-Desk action (from a row or an inline link) can fire while we're
  // already on /desk — router.push("/desk") is then a no-op, so adopt the layout
  // it just wrote to localStorage. (Off-desk, the fresh mount reads it on load.)
  useEffect(() => {
    const onChanged = () => setLayout(loadLiveLayout() ?? freshLayout());
    window.addEventListener(DESK_LAYOUT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(DESK_LAYOUT_CHANGED_EVENT, onChanged);
  }, []);

  // Esc cancels an armed move.
  useEffect(() => {
    if (!moveArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoveArmed(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moveArmed]);

  const actions = useMemo<DeskActions>(
    () => ({
      focus: (leafId) => setLayout((l) => focusLeaf(l, leafId)),
      activate: (leafId, tabId) => setLayout((l) => setActiveTab(l, leafId, tabId)),
      openItem: (leafId, itemId) =>
        setLayout((l) => addTab(l, leafId, itemTab(itemId))),
      openView: (leafId, viewId, title) =>
        setLayout((l) => addTab(l, leafId, viewTab(viewId, title))),
      openDashboard: (leafId, dashboardId, title) =>
        setLayout((l) => addTab(l, leafId, dashboardTab(dashboardId, title))),
      splitActive: (leafId, dir) =>
        setLayout((l) => {
          const leaf = findLeaf(l.root, leafId);
          const active = leaf?.tabs.find((t) => t.id === leaf.activeTab) ?? null;
          // Duplicate the active tab into the new panel (a fresh tab id pointing
          // at the same target); an empty panel splits into another empty one.
          const dup = !active
            ? []
            : active.kind === "item"
              ? [itemTab(active.itemId)]
              : active.kind === "view"
                ? [viewTab(active.viewId, active.title)]
                : [dashboardTab(active.dashboardId, active.title)];
          return splitLeaf(l, leafId, dir, dup, false).layout;
        }),
      closeTab: (leafId, tabId) => setLayout((l) => closeTab(l, leafId, tabId)),
      closePanel: (leafId) => setLayout((l) => closeLeaf(l, leafId)),
      setSection: (leafId, tabId, section) =>
        setLayout((l) => setTabSection(l, leafId, tabId, section)),
      moveTab: (fromLeafId, tabId, target) => {
        setLayout((l) => moveTab(l, fromLeafId, tabId, target));
        setMoveArmed(null);
      },
      setFrac: (splitId, frac) => setLayout((l) => setFrac(l, splitId, frac)),
      armMove: (fromLeafId, tabId) => setMoveArmed({ fromLeafId, tabId }),
      cancelMove: () => setMoveArmed(null),
    }),
    []
  );

  // --- Workspace + Recent handlers (passed to the top-bar menu) ---
  // Persist the workspace list to the synced settings jsonb (parse-with-defaults
  // in updateSettings; no migration). Optimistic: local state updates first.
  const persistWorkspaces = (next: DeskWorkspace[]) => {
    setWorkspaces(next);
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deskWorkspaces: next }),
    }).catch(() => showToast("Couldn’t save workspaces"));
  };

  const saveNewWorkspace = (name: string) => {
    const ws: DeskWorkspace = { id: newWorkspaceId(), name, savedAt: Date.now(), layout };
    persistWorkspaces([...workspaces, ws]);
    setActiveWorkspaceId(ws.id);
    showToast(`Saved workspace “${name}”`);
  };

  const updateWorkspace = (id: string) => {
    persistWorkspaces(
      workspaces.map((w) => (w.id === id ? { ...w, layout, savedAt: Date.now() } : w))
    );
    showToast("Workspace updated");
  };

  const renameWorkspace = (id: string, name: string) =>
    persistWorkspaces(workspaces.map((w) => (w.id === id ? { ...w, name } : w)));

  const deleteWorkspace = (id: string) => {
    persistWorkspaces(workspaces.filter((w) => w.id !== id));
    if (activeWorkspaceId === id) setActiveWorkspaceId(null);
  };

  // Loading anything that replaces the live layout snapshots the outgoing one to
  // Recent first — the "never lose a layout" guarantee.
  const replaceLayout = (next: DeskLayout) => {
    setRecent(snapshotToRecent(layout));
    setLayout(next);
  };

  const loadWorkspace = (id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;
    replaceLayout(ws.layout);
    setActiveWorkspaceId(id);
  };

  const restoreRecent = (id: string) => {
    const snap = recent.find((s) => s.id === id);
    if (!snap) return;
    replaceLayout(snap.layout);
    setActiveWorkspaceId(null);
  };

  const promoteRecent = (id: string, name: string) => {
    const snap = recent.find((s) => s.id === id);
    if (!snap) return;
    persistWorkspaces([
      ...workspaces,
      { id: newWorkspaceId(), name, savedAt: Date.now(), layout: snap.layout },
    ]);
    showToast(`Saved workspace “${name}”`);
  };

  const workspacesMenu = (
    <DeskWorkspacesMenu
      workspaces={workspaces}
      recent={recent}
      activeWorkspaceId={activeWorkspaceId}
      onSaveNew={saveNewWorkspace}
      onUpdate={updateWorkspace}
      onLoadWorkspace={loadWorkspace}
      onRenameWorkspace={renameWorkspace}
      onDeleteWorkspace={deleteWorkspace}
      onLoadRecent={restoreRecent}
      onPromoteRecent={promoteRecent}
    />
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
    <DeskProvider
      value={{ layout, focusedLeaf: layout.focusedLeaf, moveArmed, actions }}
    >
      <div className="flex h-[100dvh] flex-col bg-surface-0">
        <DeskTopBar right={workspacesMenu} />
        {moveArmed && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-accent/40 bg-accent/10 px-4 py-1.5 text-xs text-ink">
            <span>
              Click a panel zone to move the tab — center adds it as a tab, an
              edge splits that panel.
            </span>
            <button
              type="button"
              onClick={() => actions.cancelMove()}
              className="shrink-0 rounded border border-line px-2 py-0.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              Cancel (Esc)
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <DeskShell />
        </div>
      </div>
    </DeskProvider>
  );
}

// The top bar: the surface name and (on desktop) the workspaces pill.
function DeskTopBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-4">
      <div className="flex items-center gap-2">
        <span className="ui-section-label text-ink-muted">Desk</span>
      </div>
      <div className="flex items-center gap-2">{right}</div>
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
        {tabs.map((t) => {
          if (t.kind === "item") return <MobileItemRow key={t.id} itemId={t.itemId} />;
          const href = t.kind === "view" ? `/views/${t.viewId}` : `/dashboards/${t.dashboardId}`;
          const label = t.title?.trim() || (t.kind === "view" ? "View" : "Dashboard");
          return (
            <li key={t.id}>
              <Link
                href={href}
                className="block rounded-card border border-line bg-surface-1 px-3 py-2 text-sm text-ink hover:bg-surface-2"
              >
                {label}
              </Link>
            </li>
          );
        })}
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
