// A dashboard shown read-only in a Desk panel (ADR-146, S5). Fetches the
// fully-resolved widget data (GET /api/dashboards/[id]/resolved) and renders the
// same react-grid-layout grid the full page uses, but static: editMode=false, so
// RGL turns off drag/resize and it's pure CSS positioning (which sidesteps the
// known RGL edit-mode quirk entirely). WidthProvider measures the PANEL width, so
// a narrow panel collapses to fewer columns / a single-column stack. "Edit"
// always opens the full dashboard page.
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ViewItem } from "@/components/views/ViewRenderer";
import DashboardGridLayout from "@/components/dashboards/DashboardGridLayout";
import type { WidgetData } from "@/lib/dashboard-widgets";

// The date fields the widget bodies format (Intl.format needs real Dates, but
// JSON delivered them as ISO strings). Revive them before the grid renders.
const DATE_KEYS = [
  "dueDate",
  "scheduledDate",
  "meetingAt",
  "createdAt",
  "updatedAt",
] as const;

function reviveItem(i: ViewItem): ViewItem {
  const out = { ...i } as Record<string, unknown>;
  for (const k of DATE_KEYS) {
    const v = out[k];
    if (typeof v === "string") out[k] = new Date(v);
  }
  return out as unknown as ViewItem;
}

function reviveWidget(wd: WidgetData): WidgetData {
  const next: WidgetData = { ...wd };
  if (next.items) next.items = next.items.map(reviveItem);
  if (next.parents) next.parents = next.parents.map(reviveItem);
  if (next.childrenByParent) {
    const revived: Record<string, ViewItem[]> = {};
    for (const [pid, kids] of Object.entries(next.childrenByParent)) {
      revived[pid] = kids.map(reviveItem);
    }
    next.childrenByParent = revived;
  }
  if (next.childData) next.childData = next.childData.map(reviveWidget);
  return next;
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; name: string; widgets: WidgetData[] };

const noop = () => {};

export default function DeskDashboardPanel({ dashboardId }: { dashboardId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboards/${dashboardId}/resolved`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        const dash = d.dashboard ?? {};
        setState({
          status: "ready",
          name: typeof dash.name === "string" ? dash.name : "Dashboard",
          widgets: Array.isArray(dash.widgets) ? dash.widgets.map(reviveWidget) : [],
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardId]);

  if (state.status === "loading")
    return <Message>Loading dashboard…</Message>;
  if (state.status === "error")
    return <Message>Couldn’t load this dashboard.</Message>;

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-1 px-3 py-1.5">
        <span className="ui-row truncate text-ink">{state.name}</span>
        <Link
          href={`/dashboards/${dashboardId}`}
          title="Open the full dashboard to edit"
          className="shrink-0 rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          Edit ↗
        </Link>
      </div>
      <div className="px-3 py-3">
        {state.widgets.length > 0 ? (
          <DashboardGridLayout
            widgets={state.widgets}
            editMode={false}
            onLayoutChange={noop}
            onRemove={noop}
            onSettings={noop}
            onAppearance={noop}
          />
        ) : (
          <p className="px-1 py-6 text-sm text-ink-subtle">This dashboard has no widgets.</p>
        )}
      </div>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-subtle">
      {children}
    </div>
  );
}
