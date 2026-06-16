// One widget cell. Most kinds render a card with a header (drag handle in edit
// mode, title, count, gear, remove) over the body. A `text` widget is structure,
// not data, so it renders chrome-free (just the heading/note) with the edit
// controls as a small overlay in edit mode. The drag handle carries
// .widget-drag-handle (react-grid-layout's draggableHandle); interactive bits
// carry .cancel-drag so a click/scroll never starts a drag.
"use client";

import Link from "next/link";
import { useState } from "react";
import type { ViewWidgetSettings, WidgetData, WidgetSettings } from "@/lib/dashboard-widgets";
import WidgetBody from "./WidgetBody";
import WidgetSettingsPopover from "./WidgetSettingsPopover";

function widgetTitle(data: WidgetData): string {
  const { widget } = data;
  if (widget.kind === "view") {
    const s = widget.settings as ViewWidgetSettings;
    return s.titleOverride || data.view?.name || "View";
  }
  if (widget.kind === "stat") return data.view?.name || "Count";
  return "label" in widget.settings ? widget.settings.label || "Action" : "Action";
}

// The edit-mode controls (gear + remove), shared by the card header and the
// chrome-free text overlay. The drag handle is rendered by the caller so it can
// be placed correctly in each layout.
function EditControls({
  data,
  onRemove,
  onSettings,
}: {
  data: WidgetData;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
}) {
  const { widget } = data;
  const [gearOpen, setGearOpen] = useState(false);
  return (
    <>
      <div className="relative shrink-0">
        <button
          onClick={() => setGearOpen((v) => !v)}
          className="cancel-drag text-neutral-500 hover:text-neutral-300"
          title="Widget settings"
          aria-label="Widget settings"
        >
          ⚙
        </button>
        {gearOpen && (
          <WidgetSettingsPopover
            widget={widget}
            onChange={(settings) => onSettings(widget.id, settings)}
            onClose={() => setGearOpen(false)}
          />
        )}
      </div>
      <button
        onClick={() => onRemove(widget.id)}
        className="cancel-drag shrink-0 text-neutral-500 hover:text-red-400"
        title="Remove widget"
        aria-label="Remove widget"
      >
        ✕
      </button>
    </>
  );
}

const DRAG_HANDLE = (
  <span
    className="widget-drag-handle cursor-grab select-none text-neutral-700"
    title="Drag to move"
    aria-hidden
  >
    ⠿
  </span>
);

export default function WidgetFrame({
  data,
  editMode,
  onRemove,
  onSettings,
}: {
  data: WidgetData;
  editMode: boolean;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
}) {
  const { widget } = data;

  // Text/heading widget: chrome-free structure. In edit mode it gets a subtle
  // dashed border (so its bounds are visible while arranging) and the controls
  // float in; in view mode it's clean.
  if (widget.kind === "text") {
    return (
      <div
        className={`group relative h-full overflow-hidden rounded-lg ${
          editMode ? "border border-dashed border-neutral-700" : ""
        }`}
      >
        {editMode && (
          <div className="absolute right-1 top-1 z-10 flex items-center gap-1.5 rounded bg-neutral-900/80 px-1.5 py-0.5 text-sm">
            {DRAG_HANDLE}
            <EditControls data={data} onRemove={onRemove} onSettings={onSettings} />
          </div>
        )}
        <WidgetBody data={data} />
      </div>
    );
  }

  const title = widgetTitle(data);
  const showCount = widget.kind === "view";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        {editMode && DRAG_HANDLE}
        {widget.viewId ? (
          <Link
            href={`/views/${widget.viewId}`}
            className="cancel-drag min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 hover:text-neutral-100"
          >
            {title}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">
            {title}
          </span>
        )}
        {showCount && (
          <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
            {data.count}
          </span>
        )}
        {editMode && <EditControls data={data} onRemove={onRemove} onSettings={onSettings} />}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <WidgetBody data={data} />
      </div>
    </div>
  );
}
