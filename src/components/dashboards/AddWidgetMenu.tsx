// Add-widget menu (edit mode), sections:
//   • Structure — a text/heading block, and a container (tabs/stack/section).
//   • Embed — embed an existing item (search), or create + embed a new note.
//   • Actions — non-data buttons (quick capture, new-from-template, link).
//   • Prebuilt — ready-made starter widgets (Tasks Due Today, …).
//   • From Views — the owner's existing saved views.
// View/Prebuilt/View add as a List, a Count, or a Nested list (parents + their
// children). The Embed/Container sections only appear when their handlers are
// passed (the top-level menu), so the container's own child menu omits them.
"use client";

import { useEffect, useState } from "react";
import type { ActionKind, ContainerMode } from "@/lib/dashboard-widgets";
import { STARTER_WIDGETS, type StarterWidget } from "@/lib/starter-widgets";
import type { ViewDefinition } from "@/lib/views";
import { FloatingMenu, usePopoverPosition } from "./floating-menu";
import type { ViewWidgetKind } from "./widget-defaults";

type Hit = { id: string; type: string; title: string };

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
  onAddEmbed,
  onAddNote,
  onAddContainer,
  onAddImage,
}: {
  onAdd: (view: ViewDefinition, kind: ViewWidgetKind) => void;
  onAddStarter: (starter: StarterWidget, kind: ViewWidgetKind) => void;
  onAddText: () => void;
  onAddAction: (action: ActionKind) => void;
  // Only the top-level menu passes these; the container child menu omits them.
  onAddEmbed?: (itemId: string, title: string) => void;
  onAddNote?: () => void;
  onAddContainer?: (mode: ContainerMode) => void;
  onAddImage?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<ViewDefinition[] | null>(null);
  const { triggerRef, pos, measure } = usePopoverPosition(320);

  useEffect(() => {
    if (!open || views) return;
    void fetch("/api/views")
      .then((r) => r.json())
      .then((d: { views: ViewDefinition[] }) => setViews(d.views))
      .catch(() => setViews([]));
  }, [open, views]);

  // A prebuilt pick: reuse a same-named view if one already exists (so repeat
  // picks don't pile up duplicate views), else create it.
  function pickStarter(s: StarterWidget, kind: ViewWidgetKind) {
    const existing = views?.find((v) => v.name === s.label);
    if (existing) onAdd(existing, kind);
    else onAddStarter(s, kind);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => {
          if (!open) measure();
          setOpen((v) => !v);
        }}
        className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:border-neutral-600"
      >
        + Add widget
      </button>
      {open && (
        <FloatingMenu
          pos={pos}
          width={320}
          anchorRef={triggerRef}
          onClose={() => setOpen(false)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
        >
          <SectionLabel>Structure</SectionLabel>
          <MenuItem
            title="Text / Heading"
            description="A section title or note to group widgets"
            onClick={() => {
              onAddText();
              setOpen(false);
            }}
          />
          {onAddContainer && (
            <MenuItem
              title="Container"
              description="A tabbed / stacked group that holds other widgets"
              onClick={() => {
                onAddContainer("tabs");
                setOpen(false);
              }}
            />
          )}
          {onAddImage && (
            <MenuItem
              title="Image"
              description="A picture from a URL — a header image or a quote graphic"
              onClick={() => {
                onAddImage();
                setOpen(false);
              }}
            />
          )}

          {(onAddNote || onAddEmbed) && (
            <>
              <Divider />
              <SectionLabel>Embed</SectionLabel>
              {onAddNote && (
                <MenuItem
                  title="New note"
                  description="Create a note and edit it right here (a sticky note)"
                  onClick={() => {
                    onAddNote();
                    setOpen(false);
                  }}
                />
              )}
              {onAddEmbed && (
                <EmbedPicker
                  onPick={(id, title) => {
                    onAddEmbed(id, title);
                    setOpen(false);
                  }}
                />
              )}
            </>
          )}

          <Divider />
          <SectionLabel>Actions</SectionLabel>
          {ACTION_ITEMS.map((a) => (
            <MenuItem
              key={a.action}
              title={a.label}
              description={a.description}
              onClick={() => {
                onAddAction(a.action);
                setOpen(false);
              }}
            />
          ))}

          <Divider />
          <SectionLabel>Prebuilt</SectionLabel>
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

          <Divider />
          <SectionLabel>From Views</SectionLabel>
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
        </FloatingMenu>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="my-1 border-t border-neutral-800" />;
}

function MenuItem({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800/60"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-200">{title}</span>
        <span className="block truncate text-xs text-neutral-600">{description}</span>
      </span>
    </button>
  );
}

function KindButtons({ onPick }: { onPick: (kind: ViewWidgetKind) => void }) {
  const btn = "shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400 hover:text-neutral-200";
  return (
    <>
      <button onClick={() => onPick("view")} className={btn} title="Add as a list widget">
        List
      </button>
      <button onClick={() => onPick("stat")} className={btn} title="Add as a count widget">
        Count
      </button>
      <button
        onClick={() => onPick("tree")}
        className={btn}
        title="Add as a nested list (items + their children)"
      >
        Nested
      </button>
    </>
  );
}

// Inline item search → embed. Modeled on AddRelation's typeahead over /api/items.
function EmbedPicker({ onPick }: { onPick: (id: string, title: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const trimmed = q.trim();

  // Empty queries clear hits in onChange (not here), so the effect only ever
  // talks to the network (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!trimmed) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items?q=${encodeURIComponent(trimmed)}&limit=8`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Hit[] };
        setHits(data.items);
      } catch {
        /* aborted/offline — next keystroke retries */
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [trimmed]);

  return (
    <div className="px-2 py-1">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) setHits([]);
        }}
        placeholder="Embed an item — search…"
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
      />
      {hits.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded border border-neutral-800">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                onClick={() => onPick(hit.id, hit.title)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800"
              >
                <span className="min-w-0 flex-1 truncate">{hit.title || "Untitled"}</span>
                <span className="shrink-0 text-xs text-neutral-500">{hit.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
