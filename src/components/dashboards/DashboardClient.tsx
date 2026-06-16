// Client owner of a dashboard: holds widget data + edit-mode, and persists every
// change through the one PATCH /api/dashboards/[id] path.
//
// Data model: the server page fetches each widget's items/count (Date-typed, via
// the RSC boundary). Layout drag/resize is purely presentational, so it persists
// (debounced) WITHOUT a refetch. Changes that alter what data a widget shows —
// adding a widget, changing item-limit/sort/render-style, (slice 4) focus — call
// router.refresh() after persisting, so the server re-fetches correctly-typed
// rows; router.refresh preserves this component's state (edit-mode stays on),
// and the effect below resyncs widgets from the new props.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Layouts } from "react-grid-layout";
import AddWidgetMenu from "./AddWidgetMenu";
import DashboardGridLayout from "./DashboardGridLayout";
import FocusPicker from "./FocusPicker";
import {
  GRID_BREAKPOINTS,
  type DashboardWidget,
  type WidgetData,
  type WidgetLayout,
  type WidgetSettings,
} from "@/lib/dashboard-widgets";
import type { StarterWidget } from "@/lib/starter-widgets";
import type { ViewDefinition } from "@/lib/views";

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
  isHome,
  isToday,
  initialWidgets,
}: {
  dashboardId: string;
  name: string;
  focusItemId: string | null;
  focusTitle: string | null;
  isHome: boolean;
  isToday: boolean;
  initialWidgets: WidgetData[];
}) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [name, setName] = useState(nameProp);
  const [editMode, setEditMode] = useState(false);
  const widgetsRef = useRef(widgets);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-adopt the server name after a refresh (adjust-during-render pattern).
  const [prevName, setPrevName] = useState(nameProp);
  if (prevName !== nameProp) {
    setPrevName(nameProp);
    setName(nameProp);
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
  // Keep the handler-facing ref in sync with the rendered widgets (a ref write,
  // so it's effect-safe; event handlers also set it eagerly).
  useEffect(() => {
    widgetsRef.current = widgets;
  }, [widgets]);

  const persistNow = useCallback(
    (next: WidgetData[]) => {
      const body = {
        name: name.trim() || nameProp,
        focusItemId,
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

  const handleSettings = useCallback(
    (id: string, settings: WidgetSettings) => {
      const next = widgetsRef.current.map((d) =>
        d.widget.id === id ? { ...d, widget: { ...d.widget, settings } } : d
      );
      // View widgets can change which/how many rows show (limit/sort/render);
      // refetch them. Stat/action settings are display/config only.
      const refetch = next.find((d) => d.widget.id === id)?.widget.kind === "view";
      void commit(next, refetch);
    },
    [commit]
  );

  const handleAdd = useCallback(
    (view: ViewDefinition, kind: "view" | "stat") => {
      const settings: WidgetSettings =
        kind === "view"
          ? { titleOverride: null, itemLimit: null, sortOverride: null, renderStyle: "compact" }
          : { label: view.name, metric: "count" };
      const widget: DashboardWidget = {
        id: crypto.randomUUID(),
        kind,
        viewId: view.id,
        settings,
        layout: {},
      };
      const optimistic: WidgetData = { widget, view, items: [], count: 0 };
      // Refetch so the new widget shows real, correctly-typed data.
      void commit([...widgetsRef.current, optimistic], true);
    },
    [commit]
  );

  // A text/heading widget: no backing view, no data fetch — just append it.
  // Starts short (one heading row) with sample text so it's visible immediately;
  // y:999 lets react-grid-layout compact it to the bottom.
  const handleAddText = useCallback(() => {
    const widget: DashboardWidget = {
      id: crypto.randomUUID(),
      kind: "text",
      viewId: null,
      settings: { heading: "Sample Header", body: "" },
      layout: {
        lg: { x: 0, y: 999, w: 4, h: 1 },
        md: { x: 0, y: 999, w: 3, h: 1 },
        sm: { x: 0, y: 999, w: 1, h: 1 },
      },
    };
    void commit([...widgetsRef.current, { widget, view: null, items: [], count: 0 }], false);
  }, [commit]);

  // A prebuilt/starter widget: create its backing view first (a real saved
  // view), then add it as a widget via handleAdd.
  const handleAddStarter = useCallback(
    async (starter: StarterWidget, kind: "view" | "stat") => {
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
        // swallow — the menu stays open-less; user can retry
      }
    },
    [handleAdd]
  );

  // Assign (or clear) this dashboard as the Home (/) or Today surface. Writes the
  // owner setting and refreshes so the button state reflects it.
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
      const body = {
        name: name.trim() || nameProp,
        focusItemId: newFocusId,
        widgets: widgetsRef.current.map((d): DashboardWidget => d.widget),
      };
      void fetch(`/api/dashboards/${dashboardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(() => router.refresh())
        .catch(() => {});
    },
    [dashboardId, name, nameProp, router]
  );

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-12">
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
          ) : (
            <h1 className="text-2xl font-bold tracking-tight text-neutral-100">{name}</h1>
          )}
          <div className="flex items-center gap-3 text-sm">
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
              <AddWidgetMenu
                onAdd={handleAdd}
                onAddStarter={handleAddStarter}
                onAddText={handleAddText}
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
              onLayoutChange={handleLayoutChange}
              onRemove={handleRemove}
              onSettings={handleSettings}
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
