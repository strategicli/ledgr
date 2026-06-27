// Tab/stack/section container body (ADR-111 DC4): holds child widgets (one level
// deep — the parser drops nested containers) and displays them by `mode`:
//   • tabs    — a tab strip; the active child fills the body.
//   • stack   — children stacked vertically, the body scrolls.
//   • section — same vertical layout (the frame header already labels the group).
// Child widgets render through the same WidgetFrame (draggable off, since they're
// not in the RGL grid), so each keeps its own appearance/gear/collapse. All child
// mutations (add / remove / settings / appearance) produce a new children array
// and flow up through onContainerChange → the dashboard's single PATCH path,
// which refetches so a newly-added view child gets its data. Tab selection is
// local (view-mode ephemeral), so switching tabs never triggers a refetch.
"use client";

import { useState } from "react";
import {
  type ContainerWidgetSettings,
  type DashboardWidget,
  type WidgetAppearance,
  type WidgetData,
  type WidgetSettings,
} from "@/lib/dashboard-widgets";
import type { StarterWidget } from "@/lib/starter-widgets";
import type { ViewDefinition } from "@/lib/views";
import AddWidgetMenu from "./AddWidgetMenu";
import WidgetFrame from "./WidgetFrame";
import { buildActionWidget, buildTextWidget, buildViewWidget } from "./widget-defaults";
import { widgetTitle } from "./widget-title";

export default function ContainerWidget({
  data,
  editMode,
  onContainerChange,
}: {
  data: WidgetData;
  editMode: boolean;
  onContainerChange: (settings: ContainerWidgetSettings) => void;
}) {
  const s = data.widget.settings as ContainerWidgetSettings;
  const childData = data.childData ?? [];
  const [tab, setTab] = useState(Math.min(Math.max(s.activeTab, 0), Math.max(childData.length - 1, 0)));

  const setChildren = (children: DashboardWidget[]) => onContainerChange({ ...s, children });
  const removeChild = (id: string) => setChildren(s.children.filter((c) => c.id !== id));
  const setChildSettings = (id: string, settings: WidgetSettings) =>
    setChildren(s.children.map((c) => (c.id === id ? { ...c, settings } : c)));
  const setChildAppearance = (id: string, appearance: WidgetAppearance) =>
    setChildren(s.children.map((c) => (c.id === id ? { ...c, appearance } : c)));
  const addChild = (w: DashboardWidget) => setChildren([...s.children, w]);

  // The add menu (edit mode), scoped to append a child to THIS container. Embed /
  // note / container entries are omitted (those props left unset), so a group
  // holds lists, counts, nested lists, headings, and actions — not other groups.
  const addMenu = (
    <AddWidgetMenu
      onAdd={(view, kind) => addChild(buildViewWidget(view, kind))}
      onAddText={() => addChild(buildTextWidget())}
      onAddAction={(action) => addChild(buildActionWidget(action))}
      onAddStarter={async (starter: StarterWidget, kind) => {
        try {
          const res = await fetch("/api/views", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(starter.view),
          });
          if (!res.ok) return;
          const { view } = (await res.json()) as { view: ViewDefinition };
          addChild(buildViewWidget(view, kind));
        } catch {
          /* swallow — user can retry */
        }
      }}
    />
  );

  const renderChild = (cd: WidgetData) => (
    <WidgetFrame
      key={cd.widget.id}
      data={cd}
      editMode={editMode}
      draggable={false}
      onRemove={removeChild}
      onSettings={setChildSettings}
      onAppearance={setChildAppearance}
    />
  );

  if (childData.length === 0) {
    return (
      <div className="flex h-full flex-col items-start gap-2 p-3">
        <p className="text-sm text-neutral-600">
          Empty group{editMode ? "" : " — Edit to add widgets here."}
        </p>
        {editMode && addMenu}
      </div>
    );
  }

  if (s.mode === "tabs") {
    const active = childData[Math.min(tab, childData.length - 1)];
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-800 px-2 py-1">
          {childData.map((cd, i) => (
            <button
              key={cd.widget.id}
              onClick={() => setTab(i)}
              className={`cancel-drag shrink-0 truncate rounded px-2 py-0.5 text-xs ${
                i === Math.min(tab, childData.length - 1)
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {widgetTitle(cd)}
            </button>
          ))}
          {editMode && <span className="cancel-drag ml-auto shrink-0">{addMenu}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">{active && renderChild(active)}</div>
      </div>
    );
  }

  // stack / section: a vertical scroll of children, each at a comfortable height.
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      {childData.map((cd) => (
        <div key={cd.widget.id} className="h-64 shrink-0">
          {renderChild(cd)}
        </div>
      ))}
      {editMode && <div className="shrink-0">{addMenu}</div>}
    </div>
  );
}
