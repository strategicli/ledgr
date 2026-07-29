// One widget cell. Chrome is driven by the widget's effective appearance (DC1):
//   • header on  → a card with a header bar (drag handle in edit mode, title,
//     count, collapse chevron, gear, remove) over the body.
//   • header off → chrome-free: the body floats directly on the stage, with the
//     edit controls as a small overlay in edit mode (the old `text`-widget path,
//     now general to every kind — a header-off stat is a floating number, a
//     header-off embed is a sticky note).
// Background / border / accent come from appearance too. A collapsible widget
// always gets a header bar (to hold the chevron); folding the widget to that bar
// happens in BOTH modes and for two reasons — see widgetFolded, which RglInner
// reads for the same decision (the forced height-1 never reaches the stored
// layout).
"use client";

import Link from "next/link";
import { useState } from "react";
import {
  effectiveAppearance,
  widgetBodyInert,
  widgetFolded,
  type WidgetAppearance,
  type WidgetData,
  type WidgetSettings,
} from "@/lib/dashboard-widgets";
import { badgeCount } from "@/lib/format-count";
import { ACCENT_CLASS, BG_CLASS } from "./appearance-styles";
import { usePopoverPosition } from "./floating-menu";
import { titleHref, widgetTitle } from "./widget-title";
import WidgetBody from "./WidgetBody";
import WidgetSettingsPopover from "./WidgetSettingsPopover";

// Widget chrome as SVG, not text characters (R3/3). Same house idiom as
// NavGlyph and canvas/action-icons: a 24-box stroke glyph at currentColor, no
// icon dependency (Principle 5). The old ⠿ ⚙ ✕ ▸ ▾ rendered at the font's size
// and weight, so they sat off-baseline and varied by platform. The gear is the
// app's existing gear (SectionCountGear's path), so every gear in Ledgr matches.
const CHROME_ICONS = {
  grip:
    '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.35"/><circle cx="15" cy="6" r="1.35"/><circle cx="9" cy="12" r="1.35"/><circle cx="15" cy="12" r="1.35"/><circle cx="9" cy="18" r="1.35"/><circle cx="15" cy="18" r="1.35"/></g>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
} as const;

function Glyph({ icon, size = 14 }: { icon: keyof typeof CHROME_ICONS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
      focusable={false}
      dangerouslySetInnerHTML={{ __html: CHROME_ICONS[icon] }}
    />
  );
}

// The edit-mode controls (gear + remove), shared by the card header and the
// chrome-free overlay. The drag handle is rendered by the caller so it can be
// placed correctly in each layout.
function EditControls({
  data,
  onRemove,
  onSettings,
  onAppearance,
  onViewChange,
}: {
  data: WidgetData;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
  onAppearance: (id: string, appearance: WidgetAppearance) => void;
  onViewChange?: (id: string, viewId: string) => void;
}) {
  const { widget } = data;
  const [gearOpen, setGearOpen] = useState(false);
  // 300 = the popover's real width; a smaller measurement let the panel sit past
  // its measured box (and off-screen) near the right viewport edge.
  const { triggerRef, pos, measure } = usePopoverPosition(300);
  return (
    <>
      <div className="relative shrink-0">
        <button
          type="button"
          ref={triggerRef}
          onClick={() => {
            if (!gearOpen) measure();
            setGearOpen((v) => !v);
          }}
          className="cancel-drag inline-flex text-neutral-500 hover:text-neutral-300"
          title="Widget settings"
          aria-label="Widget settings"
        >
          <Glyph icon="gear" />
        </button>
        {gearOpen && (
          <WidgetSettingsPopover
            widget={widget}
            pos={pos}
            anchorRef={triggerRef}
            onChange={(settings) => onSettings(widget.id, settings)}
            onAppearance={(appearance) => onAppearance(widget.id, appearance)}
            onViewChange={onViewChange ? (viewId) => onViewChange(widget.id, viewId) : undefined}
            onClose={() => setGearOpen(false)}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(widget.id)}
        className="cancel-drag inline-flex shrink-0 text-neutral-500 hover:text-red-400"
        title="Remove widget"
        aria-label="Remove widget"
      >
        <Glyph icon="close" />
      </button>
    </>
  );
}

const DRAG_HANDLE = (
  <span
    className="widget-drag-handle inline-flex cursor-grab select-none text-neutral-700"
    title="Drag to move"
    aria-hidden
  >
    <Glyph icon="grip" size={16} />
  </span>
);

export default function WidgetFrame({
  data,
  editMode,
  onRemove,
  onSettings,
  onAppearance,
  onViewChange,
  today,
  focusItemId,
  draggable = true,
}: {
  data: WidgetData;
  editMode: boolean;
  onRemove: (id: string) => void;
  onSettings: (id: string, settings: WidgetSettings) => void;
  onAppearance: (id: string, appearance: WidgetAppearance) => void;
  // Repoint a view-backed widget at another saved view (the gear's "Shows"
  // picker). Optional — absent on the Desk's read-only panel and on container
  // children, where the picker simply doesn't render.
  onViewChange?: (id: string, viewId: string) => void;
  // App-timezone today (YYYY-MM-DD); threaded to the body so its rows can carry
  // the shared row menu (ADR-142).
  today?: string;
  // The dashboard's focus item, if any; the body's inline add relates new items
  // to it so they don't fall out of the focus-scoped view (W4/P4).
  focusItemId?: string | null;
  // Container children render through this frame too, but they aren't in the RGL
  // grid, so the drag handle is suppressed for them.
  draggable?: boolean;
}) {
  const { widget } = data;
  const ap = effectiveAppearance(widget);

  // Folded = header bar only. Now true in edit mode as well, so arranging the
  // board and looking at it agree; RglInner reads the SAME predicate for the
  // one-row cell, and protects the stored expanded height on the way back out.
  const folded = widgetFolded(data, editMode, today);
  // A collapsible widget always shows a header bar (it holds the chevron).
  const renderHeader = ap.showHeader || ap.collapsible;
  const showTitle = ap.showHeader || folded;
  const showBody = !folded;
  const showCount = (widget.kind === "view" || widget.kind === "tree") && showTitle;

  const wrapperBg = BG_CLASS[ap.background];
  const wrapperBorder = ap.showBorder ? "border border-neutral-800" : "";
  const accent = ACCENT_CLASS[ap.accent];
  const href = titleHref(data);
  const title = widgetTitle(data);

  // Works in edit mode too — that's how you expand a collapsed widget in order
  // to resize it, now that collapse is honest while arranging.
  const chevron = ap.collapsible ? (
    <button
      type="button"
      onClick={() => onAppearance(widget.id, { ...ap, collapsed: !ap.collapsed })}
      className="cancel-drag inline-flex shrink-0 text-neutral-500 hover:text-neutral-300"
      title={ap.collapsed ? "Expand" : "Collapse"}
      aria-label={ap.collapsed ? "Expand widget" : "Collapse widget"}
    >
      <Glyph icon={ap.collapsed ? "chevronRight" : "chevronDown"} />
    </button>
  ) : null;

  // Chrome-free path (header off, not collapsible): the body floats; edit
  // controls overlay in edit mode. Background/border/accent still apply.
  if (!renderHeader) {
    const body = (
      <WidgetBody
        data={data}
        editMode={editMode}
        onSettings={onSettings}
        today={today}
        focusItemId={focusItemId}
      />
    );
    // R3/4: with no header there's nothing to click, so a header-off stat is a
    // dead number and a header-off view has no route to its source. Let the whole
    // tile carry the widget's link — but ONLY where the body has nothing clickable
    // of its own (widgetBodyInert): an <a> around rows, the embed editor, the
    // inline add, or an image's own link would hijack their clicks. Off in edit
    // mode, where a stray click should never navigate away mid-arrangement.
    const tileHref = !editMode && href && widgetBodyInert(data, editMode, today) ? href : null;
    return (
      <div
        className={`group relative h-full overflow-hidden rounded-lg ${wrapperBg} ${accent} ${
          ap.showBorder ? "border border-neutral-800" : editMode ? "border border-dashed border-neutral-700" : ""
        }`}
      >
        {editMode && (
          <div className="absolute right-1 top-1 z-10 flex items-center gap-1.5 rounded bg-neutral-900/80 px-1.5 py-0.5 text-sm">
            {draggable && DRAG_HANDLE}
            <EditControls
              data={data}
              onRemove={onRemove}
              onSettings={onSettings}
              onAppearance={onAppearance}
              onViewChange={onViewChange}
            />
          </div>
        )}
        {tileHref ? (
          <Link href={tileHref} title={title} className="cancel-drag block h-full w-full">
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-lg ${wrapperBorder} ${wrapperBg} ${accent}`}>
      <header
        className={`flex items-center gap-2 px-3 py-2 ${ap.showBorder ? "border-b border-line" : ""}`}
      >
        {editMode && draggable && DRAG_HANDLE}
        {chevron}
        {showTitle &&
          (href ? (
            <Link
              href={href}
              className="cancel-drag min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-neutral-100"
            >
              {title}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {title}
            </span>
          ))}
        {!showTitle && <span className="min-w-0 flex-1" />}
        {showCount && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
            {badgeCount(data.count)}
          </span>
        )}
        {editMode && (
          <EditControls
            data={data}
            onRemove={onRemove}
            onSettings={onSettings}
            onAppearance={onAppearance}
            onViewChange={onViewChange}
          />
        )}
      </header>
      {showBody && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <WidgetBody
            data={data}
            editMode={editMode}
            onSettings={onSettings}
            today={today}
            focusItemId={focusItemId}
          />
        </div>
      )}
    </div>
  );
}
