// Add-widget menu (edit mode), sections:
//   • Structure — a text/heading block, and a container (tabs/stack/section).
//   • Embed — embed an existing item (search), or create + embed a new note.
//   • Actions — non-data buttons (quick capture, new-from-template, link).
//   • Prebuilt — ready-made starter widgets (Tasks Due Today, …), minus any whose
//     backing view already exists (it's listed under From Views instead).
//   • From Views — the owner's existing saved views.
// A filter input at the top narrows the Prebuilt + From Views lists.
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

// Wide enough that "Transcripts awaiting review" reads in one line.
const MENU_WIDTH = 380;

const ACTION_ITEMS: { action: ActionKind; label: string; description: string }[] = [
  { action: "new-from-template", label: "New from template", description: "Create an item from a template in one click" },
  { action: "quick-capture", label: "Quick capture", description: "Create a blank item of a type and open it" },
  { action: "link", label: "Link", description: "A button that navigates to a page or URL" },
];

// Does this saved view already *contain* the starter? Name alone was the old
// (fragile) test — it would silently reuse an unrelated view that happened to
// share the name. Requiring the filter's type and the sort field to agree too
// keeps it shallow (no key-order/normalization traps of a deep compare) while
// making a false match harmless: such a view really is the same widget.
function matchesStarter(v: ViewDefinition, s: StarterWidget) {
  return (
    v.name === s.view.name &&
    v.filter?.type === s.view.filter?.type &&
    v.sort?.field === s.view.sort?.field
  );
}

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
  const [q, setQ] = useState("");
  const [views, setViews] = useState<ViewDefinition[] | null>(null);
  const { triggerRef, pos, measure } = usePopoverPosition(MENU_WIDTH);

  useEffect(() => {
    if (!open || views) return;
    void fetch("/api/views")
      .then((r) => r.json())
      .then((d: { views: ViewDefinition[] }) => setViews(d.views))
      .catch(() => setViews([]));
  }, [open, views]);

  // A prebuilt pick: reuse the matching view if one already exists (so repeat
  // picks don't pile up duplicate views), else create it. Prebuilts whose view
  // exists are hidden below (they'd otherwise be listed twice), so this branch
  // is the guard for a pick made while the views are still loading.
  function pickStarter(s: StarterWidget, kind: ViewWidgetKind) {
    const existing = views?.find((v) => matchesStarter(v, s));
    if (existing) onAdd(existing, kind);
    else onAddStarter(s, kind);
    setOpen(false);
  }

  const needle = q.trim().toLowerCase();
  const hit = (...text: string[]) =>
    !needle || text.some((t) => t.toLowerCase().includes(needle));
  // A prebuilt already saved as a view is dropped: it appears under From Views
  // with the same three buttons, so listing it twice was pure duplication.
  const starters = STARTER_WIDGETS.filter(
    (s) => !views?.some((v) => matchesStarter(v, s)) && hit(s.label, s.description)
  );
  const shownViews = views?.filter((v) => hit(v.name)) ?? null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => {
          if (!open) {
            measure();
            setQ("");
          }
          setOpen((v) => !v);
        }}
        className="rounded-md border border-line-strong px-3 py-1 text-sm text-ink-muted hover:border-neutral-600 hover:text-ink"
      >
        {/* "+ Add" on a phone: at 375px the full label pushed Done onto a third
            row of the edit header. Desktop keeps the explicit wording. */}
        + Add<span className="hidden sm:inline"> widget</span>
      </button>
      {open && (
        <FloatingMenu
          pos={pos}
          width={MENU_WIDTH}
          anchorRef={triggerRef}
          onClose={() => setOpen(false)}
          className="rounded-card border border-line bg-surface-1 p-1 shadow-xl"
        >
          <div className="px-2 pb-1 pt-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter prebuilt + views…"
              className="w-full rounded border border-line bg-surface-0 px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
            />
          </div>
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

          {starters.length > 0 && (
            <>
              <Divider />
              <SectionLabel>Prebuilt</SectionLabel>
              {starters.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{s.label}</span>
                    <span className="block text-xs text-ink-faint">{s.description}</span>
                  </span>
                  <KindButtons onPick={(k) => pickStarter(s, k)} />
                </div>
              ))}
            </>
          )}

          <Divider />
          <SectionLabel>From Views</SectionLabel>
          {shownViews === null ? (
            <p className="px-3 py-2 text-sm text-ink-subtle">Loading views…</p>
          ) : shownViews.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-subtle">
              {needle
                ? "No matches."
                : "No saved views yet. Create one in Build → Views."}
            </p>
          ) : (
            shownViews.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 text-sm text-ink">{v.name}</span>
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
        <span className="block text-sm text-ink">{title}</span>
        <span className="block text-xs text-ink-faint">{description}</span>
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
