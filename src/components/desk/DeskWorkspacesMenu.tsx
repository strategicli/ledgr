// The top-bar workspaces pill (ADR-146, S2): named workspaces on top (synced via
// users.settings), the Recent auto-snapshot ring below (per device). Save the
// current layout as a named workspace, load / rename / delete one, or restore /
// promote a Recent snapshot. Loading anything snapshots the outgoing layout to
// Recent first (handled by the parent), so a layout is never lost.
"use client";

import { useEffect, useRef, useState } from "react";
import type { DeskWorkspace } from "@/lib/settings";
import type { RecentSnapshot } from "@/lib/desk/persist";

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DeskWorkspacesMenu({
  workspaces = [],
  recent = [],
  activeWorkspaceId,
  onSaveNew,
  onUpdate,
  onLoadWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onLoadRecent,
  onPromoteRecent,
}: {
  workspaces: DeskWorkspace[];
  recent: RecentSnapshot[];
  activeWorkspaceId: string | null;
  onSaveNew: (name: string) => void;
  onUpdate: (id: string) => void;
  onLoadWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onLoadRecent: (id: string) => void;
  onPromoteRecent: (id: string, name: string) => void;
}) {
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

  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const pillLabel = active ? active.name : "Workspaces";
  const itemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Saved workspaces and recent layouts"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[16rem] items-center gap-1 rounded-card border border-line bg-surface-2 px-3 py-1 text-xs text-ink-muted hover:text-ink"
      >
        <span className="truncate">{pillLabel}</span>
        <span className="text-ink-subtle">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 max-h-[70vh] w-72 overflow-auto rounded-card border border-line-strong bg-surface-3 p-1 shadow-2xl shadow-black/50"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              const name = window.prompt("Name this workspace")?.trim();
              if (name) onSaveNew(name);
              setOpen(false);
            }}
          >
            ＋ Save layout as…
          </button>
          {active && (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                onUpdate(active.id);
                setOpen(false);
              }}
            >
              ⤳ Update “{active.name}”
            </button>
          )}

          <div className="mt-1 border-t border-line pt-1">
            <p className="ui-meta px-2 py-1 text-ink-faint">Workspaces</p>
            {workspaces.length === 0 && (
              <p className="px-2 py-1 text-xs text-ink-subtle">None saved yet.</p>
            )}
            {workspaces.map((w) => (
              <div
                key={w.id}
                className={`group flex items-center gap-1 rounded px-1 hover:bg-surface-2 ${
                  w.id === activeWorkspaceId ? "bg-surface-2" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onLoadWorkspace(w.id);
                    setOpen(false);
                  }}
                  className="min-w-0 flex-1 truncate py-1.5 pl-1 text-left text-sm text-ink"
                  title={`Load “${w.name}”`}
                >
                  {w.name}
                </button>
                <button
                  type="button"
                  title="Rename"
                  aria-label={`Rename ${w.name}`}
                  onClick={() => {
                    const name = window.prompt("Rename workspace", w.name)?.trim();
                    if (name) onRenameWorkspace(w.id, name);
                  }}
                  className="shrink-0 rounded px-1 text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100"
                >
                  ✎
                </button>
                <button
                  type="button"
                  title="Delete"
                  aria-label={`Delete ${w.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete workspace “${w.name}”?`))
                      onDeleteWorkspace(w.id);
                  }}
                  className="shrink-0 rounded px-1 text-ink-faint opacity-0 hover:text-red-400 group-hover:opacity-100"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>

          <div className="mt-1 border-t border-line pt-1">
            <p className="ui-meta px-2 py-1 text-ink-faint">Recent (this device)</p>
            {recent.length === 0 && (
              <p className="px-2 py-1 text-xs text-ink-subtle">No recent layouts.</p>
            )}
            {recent.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-1 rounded px-1 hover:bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    onLoadRecent(s.id);
                    setOpen(false);
                  }}
                  className="min-w-0 flex-1 truncate py-1.5 pl-1 text-left text-sm text-ink-muted hover:text-ink"
                  title="Restore this layout"
                >
                  Unsaved · {formatTs(s.ts)}
                </button>
                <button
                  type="button"
                  title="Save as a named workspace"
                  aria-label="Save this recent layout as a workspace"
                  onClick={() => {
                    const name = window.prompt("Name this workspace")?.trim();
                    if (name) onPromoteRecent(s.id, name);
                  }}
                  className="shrink-0 rounded px-1 text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100"
                >
                  ＋
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
