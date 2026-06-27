// One widget cell. Chrome is driven by the widget's effective appearance (DC1):
//   • header on  → a card with a header bar (drag handle in edit mode, title,
//     count, collapse chevron, gear, remove) over the body.
//   • header off → chrome-free: the body floats directly on the stage, with the
//     edit controls as a small overlay in edit mode (the old `text`-widget path,
//     now general to every kind — a header-off stat is a floating number, a
//     header-off embed is a sticky note).
// Background / border / accent come from appearance too. A collapsible widget
// always gets a header bar (to hold the chevron); collapse is a view-mode action
// that folds the widget to its title bar (the forced height-1 lives in RglInner,
// view mode only, so it never clobbers the stored expanded height).
"use client";

import Link from "next/link";
import { useState } from "react";
import {
  effectiveAppearance,
  type WidgetAppearance,
  type WidgetData,
  type WidgetSettings,
} from "@/lib/dashboard-widgets";
import { ACCENT_CLASS, BG_CLASS } from "./appearance-styles";
import { titleHref, widgetTitle } from "./widget-title";
import WidgetBody from "./WidgetBody";
import WidgetSettingsPopover from "./WidgetSettingsPopover";

// The edit-mode controls (gear + remove), shared by the card header and the
// chrome-free overlay. The drag handle is rendered by the caller so it can be
// placed correctly in each layout.
function EditControls({
  data,
  onRemove,
  onSettings,
  onAppearance,
}: {
  data: WidgetData;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
  onAppearance: (id: string, appearance: WidgetAppearance) => void;
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
            onAppearance={(appearance) => onAppearance(widget.id, appearance)}
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
  onAppearance,
  draggable = true,
}: {
  data: WidgetData;
  editMode: boolean;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
  onAppearance: (id: string, appearance: WidgetAppearance) => void;
  // Container children render through this frame too, but they aren't in the RGL
  // grid, so the drag handle is suppressed for them.
  draggable?: boolean;
}) {
  const { widget } = data;
  const ap = effectiveAppearance(widget);

  // Collapse is visual in view mode only (the forced height-1 lives in RglInner
  // and never persists). In edit mode the widget stays expanded so resize works.
  const collapsedView = ap.collapsed && !editMode;
  // A collapsible widget always shows a header bar (it holds the chevron).
  const renderHeader = ap.showHeader || ap.collapsible;
  const showTitle = ap.showHeader || collapsedView;
  const showBody = !collapsedView;
  const showCount = (widget.kind === "view" || widget.kind === "tree") && showTitle;

  const wrapperBg = BG_CLASS[ap.background];
  const wrapperBorder = ap.showBorder ? "border border-neutral-800" : "";
  const accent = ACCENT_CLASS[ap.accent];
  const href = titleHref(data);
  const title = widgetTitle(data);

  const chevron = ap.collapsible ? (
    <button
      onClick={() => onAppearance(widget.id, { ...ap, collapsed: !ap.collapsed })}
      className="cancel-drag shrink-0 text-neutral-500 hover:text-neutral-300"
      title={ap.collapsed ? "Expand" : "Collapse"}
      aria-label={ap.collapsed ? "Expand widget" : "Collapse widget"}
    >
      {ap.collapsed ? "▸" : "▾"}
    </button>
  ) : null;

  // Chrome-free path (header off, not collapsible): the body floats; edit
  // controls overlay in edit mode. Background/border/accent still apply.
  if (!renderHeader) {
    return (
      <div
        className={`group relative h-full overflow-hidden rounded-lg ${wrapperBg} ${accent} ${
          ap.showBorder ? "border border-neutral-800" : editMode ? "border border-dashed border-neutral-700" : ""
        }`}
      >
        {editMode && (
          <div className="absolute right-1 top-1 z-10 flex items-center gap-1.5 rounded bg-neutral-900/80 px-1.5 py-0.5 text-sm">
            {draggable && DRAG_HANDLE}
            <EditControls data={data} onRemove={onRemove} onSettings={onSettings} onAppearance={onAppearance} />
          </div>
        )}
        <WidgetBody data={data} editMode={editMode} onSettings={onSettings} />
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-lg ${wrapperBorder} ${wrapperBg} ${accent}`}>
      <header
        className={`flex items-center gap-2 px-3 py-2 ${ap.showBorder ? "border-b border-neutral-800" : ""}`}
      >
        {editMode && draggable && DRAG_HANDLE}
        {chevron}
        {showTitle &&
          (href ? (
            <Link
              href={href}
              className="cancel-drag min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 hover:text-neutral-100"
            >
              {title}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">
              {title}
            </span>
          ))}
        {!showTitle && <span className="min-w-0 flex-1" />}
        {showCount && (
          <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
            {data.count}
          </span>
        )}
        {editMode && (
          <EditControls data={data} onRemove={onRemove} onSettings={onSettings} onAppearance={onAppearance} />
        )}
      </header>
      {showBody && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <WidgetBody data={data} editMode={editMode} onSettings={onSettings} />
        </div>
      )}
    </div>
  );
}
