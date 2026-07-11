// Client owner of a dashboard: holds widget data + edit-mode + the stage
// appearance, and persists every change through the one PATCH /api/dashboards/[id]
// path.
//
// Data model: the server page fetches each widget's items/count (Date-typed, via
// the RSC boundary). Layout drag/resize is purely presentational, so it persists
// (debounced) WITHOUT a refetch. Changes that alter what data a widget shows —
// adding a widget, changing item-limit/sort/render-style, tree/container settings,
// focus — call router.refresh() after persisting, so the server re-fetches
// correctly-typed rows; router.refresh preserves this component's state (edit-mode
// stays on), and the effects below resync widgets + name + appearance from props.
// Per-widget appearance (chrome) and the stage appearance are display-only, so
// they persist without a refetch.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layouts } from "react-grid-layout";
import AddWidgetMenu from "./AddWidgetMenu";
import BackgroundPanel from "./BackgroundPanel";
import DashboardGridLayout from "./DashboardGridLayout";
import FocusPicker from "./FocusPicker";
import StageBackground from "./StageBackground";
import {
  buildActionWidget,
  buildContainerWidget,
  buildEmbedWidget,
  buildImageWidget,
  buildTextWidget,
  buildViewWidget,
  type ViewWidgetKind,
} from "./widget-defaults";
import { estimateGridHeight } from "@/lib/dashboard-grid";
import {
  GRID_BREAKPOINTS,
  type ActionKind,
  type ContainerMode,
  type DashboardAppearance,
  type DashboardWidget,
  type WidgetAppearance,
  type WidgetData,
  type WidgetLayout,
  type WidgetSettings,
} from "@/lib/dashboard-widgets";
import type { StarterWidget } from "@/lib/starter-widgets";
import type { ViewDefinition } from "@/lib/views";

// Widget kinds whose data changes when their settings change → refetch on save.
const REFETCH_KINDS = new Set(["view", "tree", "container"]);

function cellFrom(all: Layouts, bp: keyof Layouts, id: string) {
  const item = (all[bp] ?? []).find((l) => l.i === id);
  return item ? { x: item.x, y: item.y, w: item.w, h: item.h } : undefined;
}

// Fold react-grid-layout's reported cells back into each widget's layout.
function mergeLayouts(widgets: WidgetData[], all: Layouts): WidgetData[] {
  return widgets.map((d) => {
    const layout: WidgetLayout = {};
    for (const bp of GRID_BREAKPOINTS) {
      const cell = cellFrom(all, bp, d.widget.id);
      if (cell) layout[bp] = cell;
    }
    return { ...d, widget: { ...d.widget, layout } };
  });
}

export default function DashboardClient({
  dashboardId,
  name: nameProp,
  focusItemId,
  focusTitle,
  appearance: appearanceProp,
  isHome,
  isToday,
  initialWidgets,
}: {
  dashboardId: string;
  name: string;
  focusItemId: string | null;
  focusTitle: string | null;
  appearance: DashboardAppearance | null;
  isHome: boolean;
  isToday: boolean;
  initialWidgets: WidgetData[];
}) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [name, setName] = useState(nameProp);
  const [appearance, setAppearance] = useState(appearanceProp);
  const [editMode, setEditMode] = useState(false);
  const widgetsRef = useRef(widgets);
  const appearanceRef = useRef(appearance);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-adopt the server name after a refresh (adjust-during-render pattern).
  const [prevName, setPrevName] = useState(nameProp);
  if (prevName !== nameProp) {
    setPrevName(nameProp);
    setName(nameProp);
  }
  const [prevAppearance, setPrevAppearance] = useState(appearanceProp);
  if (prevAppearance !== appearanceProp) {
    setPrevAppearance(appearanceProp);
    setAppearance(appearanceProp);
  }

  // Resync from the server after a router.refresh() (add / settings / focus):
  // the page passes a fresh array, so adopt it during render (React's sanctioned
  // "adjust state when a prop changes" pattern). edit-mode is separate state, so
  // it survives the refresh.
  const [prevInitial, setPrevInitial] = useState(initialWidgets);
  if (prevInitial !== initialWidgets) {
    setPrevInitial(initialWidgets);
    setWidgets(initialWidgets);
  }
  // Keep the handler-facing refs in sync with the rendered state (ref writes, so
  // effect-safe; event handlers also set them eagerly).
  useEffect(() => {
    widgetsRef.current = widgets;
  }, [widgets]);
  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  const persistNow = useCallback(
    (next: WidgetData[]) => {
      const body = {
        name: name.trim() || nameProp,
        focusItemId,
        appearance: appearanceRef.current,
        widgets: next.map((d): DashboardWidget => d.widget),
      };
      return fetch(`/api/dashboards/${dashboardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [dashboardId, name, nameProp, focusItemId]
  );

  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persistNow(widgetsRef.current), 600);
  }, [persistNow]);

  // RGL fires onLayoutChange on mount too; ignoring it in view mode avoids both
  // a spurious write and any update loop.
  const handleLayoutChange = useCallback(
    (all: Layouts) => {
      if (!editMode) return;
      const merged = mergeLayouts(widgetsRef.current, all);
      widgetsRef.current = merged;
      setWidgets(merged);
      schedulePersist();
    },
    [editMode, schedulePersist]
  );

  // Commit a change to the widget array immediately, then optionally refetch.
  const commit = useCallback(
    async (next: WidgetData[], refetch: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      widgetsRef.current = next;
      setWidgets(next);
      await persistNow(next);
      if (refetch) router.refresh();
    },
    [persistNow, router]
  );

  const handleRemove = useCallback(
    (id: string) => void commit(widgetsRef.current.filter((d) => d.widget.id !== id), false),
    [commit]
  );

  // Settings edits update the widget optimistically + immediately (so a controlled
  // input never loses a keystroke), then DEBOUNCE the persist + refetch. Without
  // the debounce, a text/select change that refetches (view/tree/container) fired
  // router.refresh() per keystroke, and a stale refresh would race the controlled
  // input and blank it (the relation-role glitch). One refresh after typing stops.
  const handleSettings = useCallback(
    (id: string, settings: WidgetSettings) => {
      const next = widgetsRef.current.map((d) =>
        d.widget.id === id ? { ...d, widget: { ...d.widget, settings } } : d
      );
      widgetsRef.current = next;
      setWidgets(next);
      const kind = next.find((d) => d.widget.id === id)?.widget.kind ?? "";
      const refetch = REFETCH_KINDS.has(kind);
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(() => {
        void persistNow(widgetsRef.current).then(() => {
          if (refetch) router.refresh();
        });
      }, 450);
    },
    [persistNow, router]
  );

  // Per-widget chrome (header/border/background/accent/collapse). Display-only —
  // never changes which data shows, so no refetch.
  const handleAppearance = useCallback(
    (id: string, ap: WidgetAppearance) => {
      const next = widgetsRef.current.map((d) =>
        d.widget.id === id ? { ...d, widget: { ...d.widget, appearance: ap } } : d
      );
      void commit(next, false);
    },
    [commit]
  );

  const handleAdd = useCallback(
    (view: ViewDefinition, kind: ViewWidgetKind) => {
      const widget = buildViewWidget(view, kind);
      // Refetch so the new widget shows real, correctly-typed data.
      void commit([...widgetsRef.current, { widget, view, items: [], count: 0 }], true);
    },
    [commit]
  );

  const handleAddText = useCallback(() => {
    const widget = buildTextWidget();
    void commit([...widgetsRef.current, { widget, view: null, items: [], count: 0 }], false);
  }, [commit]);

  const handleAddAction = useCallback(
    (action: ActionKind) => {
      const widget = buildActionWidget(action);
      void commit([...widgetsRef.current, { widget, view: null, items: [], count: 0 }], false);
    },
    [commit]
  );

  // Embed an existing item: optimistically show the title, refetch to load the
  // body (the one place a widget reads a body).
  const handleAddEmbed = useCallback(
    (itemId: string, title: string) => {
      const widget = buildEmbedWidget(itemId);
      const optimistic: WidgetData = {
        widget,
        view: null,
        items: [],
        count: 0,
        embedItem: { id: itemId, title, body: { format: "markdown", text: "" } },
      };
      void commit([...widgetsRef.current, optimistic], true);
    },
    [commit]
  );

  // New note → embed it (a sticky note). Creates the note, then embeds by id.
  const handleAddNote = useCallback(async () => {
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", title: "" }),
      });
      if (!res.ok) return;
      const { item } = (await res.json()) as { item: { id: string; title: string } };
      handleAddEmbed(item.id, item.title || "Untitled");
    } catch {
      /* swallow — user can retry */
    }
  }, [handleAddEmbed]);

  const handleAddContainer = useCallback(
    (mode: ContainerMode) => {
      const widget = buildContainerWidget(mode);
      void commit([...widgetsRef.current, { widget, view: null, items: [], count: 0, childData: [] }], false);
    },
    [commit]
  );

  const handleAddImage = useCallback(() => {
    const widget = buildImageWidget();
    void commit([...widgetsRef.current, { widget, view: null, items: [], count: 0 }], false);
  }, [commit]);

  // A prebuilt/starter widget: create its backing view first (a real saved
  // view), then add it via handleAdd.
  const handleAddStarter = useCallback(
    async (starter: StarterWidget, kind: ViewWidgetKind) => {
      try {
        const res = await fetch("/api/views", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(starter.view),
        });
        if (!res.ok) return;
        const { view } = (await res.json()) as { view: ViewDefinition };
        handleAdd(view, kind);
      } catch {
        /* swallow — the menu stays open-less; user can retry */
      }
    },
    [handleAdd]
  );

  // The dashboard stage (background/scrim/title/density). Display-only → persist
  // the explicit new value (not stale state) and update the visual; no refetch.
  const handleSetStageAppearance = useCallback(
    (next: DashboardAppearance | null) => {
      setAppearance(next);
      appearanceRef.current = next;
      if (timer.current) clearTimeout(timer.current);
      void fetch(`/api/dashboards/${dashboardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || nameProp,
          focusItemId,
          appearance: next,
          widgets: widgetsRef.current.map((d): DashboardWidget => d.widget),
        }),
      }).catch(() => {});
    },
    [dashboardId, name, nameProp, focusItemId]
  );

  // Assign (or clear) this dashboard as the Home (/) or Today surface.
  const setRole = useCallback(
    (role: "homeDashboardId" | "todayDashboardId", on: boolean) => {
      void fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [role]: on ? dashboardId : null }),
      })
        .then(() => router.refresh())
        .catch(() => {});
    },
    [dashboardId, router]
  );

  // Setting/clearing the dashboard focus re-scopes every view/stat widget, so it
  // PATCHes the new focus (explicit, not the stale prop) then refetches.
  const handleSetFocus = useCallback(
    (newFocusId: string | null) => {
      if (timer.current) clearTimeout(timer.current);
      void fetch(`/api/dashboards/${dashboardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || nameProp,
          focusItemId: newFocusId,
          appearance: appearanceRef.current,
          widgets: widgetsRef.current.map((d): DashboardWidget => d.widget),
        }),
      })
        .then(() => router.refresh())
        .catch(() => {});
    },
    [dashboardId, name, nameProp, router]
  );

  const density = appearance?.density ?? "comfortable";
  const contentPad = density === "compact" ? "py-6" : "py-10";
  const showTitle = appearance?.showTitle ?? true;

  // Reserve the grid's (estimated) height during load so the widgets don't pile
  // up before RGL measures its width. Estimated from the lg layout — a rough
  // placeholder is fine; the reservation is dropped once RGL reports its layout.
  const reservedHeight = useMemo(() => estimateGridHeight(widgets), [widgets]);

  return (
    <main className="relative min-h-screen">
      <StageBackground appearance={appearance} />
      <div className={`relative z-10 mx-auto w-full max-w-6xl px-6 ${contentPad} sm:px-12`}>
        <div className="flex items-baseline justify-between gap-2">
          {editMode ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (trimmed && trimmed !== nameProp) void persistNow(widgetsRef.current);
                else if (!trimmed) setName(nameProp);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              aria-label="Dashboard name"
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-2xl font-bold tracking-tight text-neutral-100"
            />
          ) : showTitle ? (
            <h1 className="text-2xl font-bold tracking-tight text-neutral-100">{name}</h1>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
            {!editMode && focusTitle && (
              <span className="inline-flex items-center rounded-full border border-[var(--accent)] px-2 py-0.5 text-xs text-[var(--accent)]">
                Focus: {focusTitle}
              </span>
            )}
            <Link href="/dashboards" className="text-neutral-500 hover:text-neutral-300">
              All dashboards
            </Link>
            {editMode && (
              <button
                onClick={() => setRole("homeDashboardId", !isHome)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  isHome
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                }`}
                title="Use this dashboard as your Home (/) surface"
              >
                {isHome ? "✓ Home" : "Set as Home"}
              </button>
            )}
            {editMode && (
              <button
                onClick={() => setRole("todayDashboardId", !isToday)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  isToday
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                }`}
                title="Use this dashboard as your Today surface"
              >
                {isToday ? "✓ Today" : "Set as Today"}
              </button>
            )}
            {editMode && <FocusPicker focusTitle={focusTitle} onChange={handleSetFocus} />}
            {editMode && (
              <BackgroundPanel appearance={appearance} onChange={handleSetStageAppearance} />
            )}
            {editMode && (
              <AddWidgetMenu
                onAdd={handleAdd}
                onAddStarter={handleAddStarter}
                onAddText={handleAddText}
                onAddAction={handleAddAction}
                onAddEmbed={handleAddEmbed}
                onAddNote={handleAddNote}
                onAddContainer={handleAddContainer}
                onAddImage={handleAddImage}
              />
            )}
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`rounded-md border px-3 py-1 ${
                editMode
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-neutral-700 text-neutral-300 hover:border-neutral-600"
              }`}
            >
              {editMode ? "Done" : "Edit"}
            </button>
          </div>
        </div>

        {widgets.length > 0 ? (
          <div className="mt-4">
            <DashboardGridLayout
              widgets={widgets}
              editMode={editMode}
              reservedHeight={reservedHeight}
              onLayoutChange={handleLayoutChange}
              onRemove={handleRemove}
              onSettings={handleSettings}
              onAppearance={handleAppearance}
            />
          </div>
        ) : (
          <p className="mt-8 px-2 text-sm text-neutral-600">
            No widgets yet. Click <span className="text-neutral-400">Edit</span> →{" "}
            <span className="text-neutral-400">Add widget</span> to place one.
          </p>
        )}
      </div>
    </main>
  );
}
