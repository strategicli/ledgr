// Add-widget menu (edit mode), sections:
//   • Structure — a text/heading block.
//   • Actions — non-data buttons (quick capture, new-from-template, link). Each
//     adds an action widget configured afterwards via its gear (TPL5).
//   • Prebuilt — ready-made starter widgets (Tasks Due Today, Upcoming Tasks,
//     Meetings This Week, …). Picking one creates (or reuses) its backing saved
//     view and adds the widget — no view builder needed.
//   • From Views — the owner's existing saved views.
// View/Prebuilt add as a List or a Count widget.
"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionKind } from "@/lib/dashboard-widgets";
import { STARTER_WIDGETS, type StarterWidget } from "@/lib/starter-widgets";
import type { ViewDefinition } from "@/lib/views";

type Kind = "view" | "stat";

const ACTION_ITEMS: { action: ActionKind; label: string; description: string }[] = [
  { action: "new-from-template", label: "New from template", description: "Create an item from a template in one click" },
  { action: "quick-capture", label: "Quick capture", description: "Create a blank item of a type and open it" },
  { action: "link", label: "Link", description: "A button that navigates to a page or URL" },
];

export default function AddWidgetMenu({
  onAdd,
  onAddStarter,
  onAddText,
  onAddAction,
}: {
  onAdd: (view: ViewDefinition, kind: Kind) => void;
  onAddStarter: (starter: StarterWidget, kind: Kind) => void;
  onAddText: () => void;
  onAddAction: (action: ActionKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<ViewDefinition[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || views) return;
    void fetch("/api/views")
      .then((r) => r.json())
      .then((d: { views: ViewDefinition[] }) => setViews(d.views))
      .catch(() => setViews([]));
  }, [open, views]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // A prebuilt pick: reuse a same-named view if one already exists (so repeat
  // picks don't pile up duplicate views), else create it.
  function pickStarter(s: StarterWidget, kind: Kind) {
    const existing = views?.find((v) => v.name === s.label);
    if (existing) onAdd(existing, kind);
    else onAddStarter(s, kind);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:border-neutral-600"
      >
        + Add widget
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 max-h-96 w-80 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Structure
          </p>
          <button
            onClick={() => {
              onAddText();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-200">Text / Heading</span>
              <span className="block truncate text-xs text-neutral-600">
                A section title or note to group widgets
              </span>
            </span>
          </button>

          <div className="my-1 border-t border-neutral-800" />
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Actions
          </p>
          {ACTION_ITEMS.map((a) => (
            <button
              key={a.action}
              onClick={() => {
                onAddAction(a.action);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-200">{a.label}</span>
                <span className="block truncate text-xs text-neutral-600">{a.description}</span>
              </span>
            </button>
          ))}

          <div className="my-1 border-t border-neutral-800" />
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Prebuilt
          </p>
          {STARTER_WIDGETS.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-800/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-200">{s.label}</span>
                <span className="block truncate text-xs text-neutral-600">{s.description}</span>
              </span>
              <KindButtons onPick={(k) => pickStarter(s, k)} />
            </div>
          ))}

          <div className="my-1 border-t border-neutral-800" />
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            From Views
          </p>
          {views === null ? (
            <p className="px-3 py-2 text-sm text-neutral-500">Loading views…</p>
          ) : views.length === 0 ? (
            <p className="px-3 py-2 text-sm text-neutral-500">
              No saved views yet. Create one in Build → Views.
            </p>
          ) : (
            views.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-800/60"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{v.name}</span>
                <KindButtons
                  onPick={(k) => {
                    onAdd(v, k);
                    setOpen(false);
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function KindButtons({ onPick }: { onPick: (kind: Kind) => void }) {
  return (
    <>
      <button
        onClick={() => onPick("view")}
        className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
        title="Add as a list widget"
      >
        List
      </button>
      <button
        onClick={() => onPick("stat")}
        className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
        title="Add as a count widget"
      >
        Count
      </button>
    </>
  );
}
