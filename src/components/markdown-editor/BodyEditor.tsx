// The body's mode switch (ADR-125): one client component that decides HOW a
// body is edited, so every canvas (markdown, task, link, modules) inherits the
// behavior for free — they all route the body through ItemEditor, which now
// renders this.
//
// Three modes over one canonical markdown body (ADR-037):
//   - rich    — the Tiptap WYSIWYG (TabbedBody when the type uses tabs, else the
//               plain editor). The default for normal-size bodies.
//   - source  — the raw markdown in a <textarea> (RawMarkdownEditor). Available
//               on ANY note as a power tool, and the only editor offered for a
//               large body, since a contenteditable tree that size freezes.
//   - preview — read-only rendered HTML (MarkdownPreview). The default landing
//               for a large body: reading is the common act for a document-note.
//
// Size gate: at/above LARGE_BODY_THRESHOLD the rich editor is never mounted; the
// body opens in preview with a banner and a "Edit as text" → source path.
//
// Mode-switch text sync: every editor emits markdown through `handleChange`,
// kept in `liveText`. Switching modes snapshots that into `mountText` (the
// content the freshly-mounted child is seeded with) and keys the child by mode,
// so a switch always carries the latest text across — including unsaved edits.
"use client";

import { useRef, useState } from "react";
import LazyMarkdownEditor from "./LazyMarkdownEditor";
import TabbedBody from "./TabbedBody";
import RawMarkdownEditor from "./RawMarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";
import { isLargeBody } from "@/lib/body";
import { setToolbarOpenPref, useToolbarOpenPref } from "@/lib/toolbar-prefs";
import type { PromotedRefs } from "./block-anchor-extension";
import "./markdown-editor.css";

type Mode = "rich" | "source" | "preview";

export type BodyEditorProps = {
  itemId: string;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  uploadImage: (file: File) => Promise<string>;
  onRequestSave?: () => Promise<void>;
  promoteToMeetingId?: string;
  promotedRefs?: PromotedRefs;
  collapsibleToolbar?: boolean;
  compact?: boolean;
  editable?: boolean;
  // The type uses canvas tabs (notes, opt-in types). Honored only in rich mode
  // and only for normal-size bodies; a large body is edited as one flat document.
  tabsEnabled?: boolean;
  // Desk panels (ADR-147 D5): the active canvas-section is controlled by the
  // panel chrome and TabbedBody's own strip is hidden. Forwarded to TabbedBody.
  controlledSection?: number;
  // Imperative focus signal (title Enter → jump to the body): forwarded to the
  // rich editor. Only meaningful in rich mode; source/preview ignore it.
  focusSignal?: number;
};

function ModeButton({
  active,
  onClick,
  title,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  // When set (the icon-only Rich/Source toggle), gives the button a tooltip +
  // accessible name; the large-body banner leaves them off (its text labels are
  // self-describing).
  title?: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
        active
          ? "bg-surface-2 text-ink"
          : "text-ink-subtle hover:bg-surface-2 hover:text-ink-muted"
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// The Rich/Source toggle icons (ui-refresh Q8): rendered-lines = the WYSIWYG
// editor, code-brackets = the raw markdown source. Kept inline in BodyEditor (no
// state lift into the ⋯ menu) so the toggle stays available in every canvas
// variant — page, peek, and the mobile bottom sheet — where the ⋯ menu is not.
const RICH_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="14" y2="18" />
  </svg>
);
const SOURCE_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="8 7 3 12 8 17" />
    <polyline points="16 7 21 12 16 17" />
  </svg>
);
// The Preview/Reading toggle (slice 7): an eye — read-only rendered output, where
// live {{item.*}}/{{parent.*}}/{{now.*}} tokens resolve to their current values
// (MarkdownPreview posts itemId to /api/render-markdown). Its own glyph, distinct
// from the Rich/Source pair, so the row reads as three views.
const PREVIEW_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
// The collapse toggle's glyph (S5): a text-format "A" + baseline — deliberately
// distinct from the two view-mode icons (rendered-lines, code-brackets) so it
// reads as "show/hide the formatting bar," not a third view mode.
const FORMAT_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 20h16" />
    <path d="m6 16 6-12 6 12" />
    <path d="M8.5 11h7" />
  </svg>
);

export default function BodyEditor({
  itemId,
  initialMarkdown,
  onChange,
  uploadImage,
  onRequestSave,
  promoteToMeetingId,
  promotedRefs,
  collapsibleToolbar = false,
  compact = false,
  editable = true,
  tabsEnabled = false,
  controlledSection,
  focusSignal,
}: BodyEditorProps) {
  const large = isLargeBody(initialMarkdown);
  // Latest emitted markdown (every mode reports through handleChange).
  const liveText = useRef(initialMarkdown);
  // Content the currently-mounted child is seeded with; only re-snapshotted on a
  // mode switch, so editing within a mode never remounts the child.
  const [mountText, setMountText] = useState(initialMarkdown);
  const [mode, setMode] = useState<Mode>(large ? "preview" : "rich");

  // Formatting-bar collapse state (S5). The toggle lives in the mode-row below
  // and its state is owned here so it survives a rich↔source switch and persists
  // per item. Default follows the surface: notes (tabbed) start OPEN; task/compact
  // bodies (collapsibleToolbar, not tabbed) start COLLAPSED. A stored per-item
  // preference wins over the default.
  const defaultToolbarOpen = tabsEnabled || !collapsibleToolbar;
  const toolbarOpen = useToolbarOpenPref(itemId, defaultToolbarOpen);
  const toggleToolbar = () => setToolbarOpenPref(itemId, !toolbarOpen);
  // The collapse toggle is offered only where a formatting bar exists to hide:
  // an editable, collapsible surface, in rich mode. (Desktop-only; hidden below
  // `sm` in CSS, where the bar always shows above the keyboard. A locked note has
  // no bar to collapse, so no toggle.)
  const showCollapseToggle = editable && collapsibleToolbar && mode === "rich";

  const handleChange = (md: string) => {
    liveText.current = md;
    onChange(md);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMountText(liveText.current);
    setMode(next);
  };

  // The body's view-mode controls: the collapse toggle (desktop + rich only) and
  // the Rich/Source/Preview segmented pill. One element, rendered in two places
  // (ADR-125, merged in S8): in rich mode on desktop it's handed to the editor
  // and rides the right end of the formatting bar; on mobile, and in
  // source/preview mode, it sits in the top row below instead. Only one copy is
  // ever visible at a time (the responsive visibility below decides which).
  const viewControls = (
    <>
      {showCollapseToggle && (
        <button
          type="button"
          onClick={toggleToolbar}
          aria-pressed={toolbarOpen}
          title={toolbarOpen ? "Hide formatting bar" : "Show formatting bar"}
          aria-label={toolbarOpen ? "Hide formatting bar" : "Show formatting bar"}
          className={`hidden rounded-md px-2 py-1 sm:inline-flex sm:items-center ${
            toolbarOpen
              ? "bg-surface-2 text-ink"
              : "text-ink-subtle hover:bg-surface-2 hover:text-ink-muted"
          }`}
        >
          {FORMAT_ICON}
        </button>
      )}
      <div className="inline-flex items-center gap-0.5 rounded-card border border-line bg-surface-0 p-0.5">
        <ModeButton active={mode === "rich"} onClick={() => switchMode("rich")} title="Rich text" label="Rich text editor">
          {RICH_ICON}
        </ModeButton>
        <ModeButton active={mode === "source"} onClick={() => switchMode("source")} title="Markdown source" label="Markdown source">
          {SOURCE_ICON}
        </ModeButton>
        <ModeButton active={mode === "preview"} onClick={() => switchMode("preview")} title="Preview — tokens resolve here" label="Preview rendered output">
          {PREVIEW_ICON}
        </ModeButton>
      </div>
    </>
  );

  let child: React.ReactNode;
  if (mode === "preview") {
    child = <MarkdownPreview key="preview" text={mountText} itemId={itemId} />;
  } else if (mode === "source") {
    child = (
      <RawMarkdownEditor
        key="source"
        initialMarkdown={mountText}
        onChange={handleChange}
        editable={editable}
      />
    );
  } else if (tabsEnabled) {
    child = (
      <TabbedBody
        key="rich-tabbed"
        itemId={itemId}
        initialMarkdown={mountText}
        uploadImage={uploadImage}
        onChange={handleChange}
        promoteToMeetingId={promoteToMeetingId}
        promotedRefs={promotedRefs}
        onRequestSave={onRequestSave}
        editable={editable}
        controlledSection={controlledSection}
        focusSignal={focusSignal}
        toolbarOpen={toolbarOpen}
        viewControls={viewControls}
      />
    );
  } else {
    child = (
      <LazyMarkdownEditor
        key="rich"
        itemId={itemId}
        initialMarkdown={mountText}
        uploadImage={uploadImage}
        onChange={handleChange}
        promoteToMeetingId={promoteToMeetingId}
        promotedRefs={promotedRefs}
        toolbarOpen={toolbarOpen}
        viewControls={viewControls}
        compact={compact}
        onRequestSave={onRequestSave}
        editable={editable}
        focusSignal={focusSignal}
      />
    );
  }

  return (
    <div>
      {large ? (
        // Document-note: explain why the rich editor is off, and offer the two
        // safe modes. Reading is the default; "Edit as text" drops into source.
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/80">
          <span className="min-w-0">
            This note is large, so it opens in reading mode for speed.{" "}
            {editable
              ? "Edit it as raw markdown text."
              : "It is locked, so it is read-only."}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <ModeButton active={mode === "preview"} onClick={() => switchMode("preview")}>
              Reading
            </ModeButton>
            <ModeButton active={mode === "source"} onClick={() => switchMode("source")}>
              {editable ? "Edit as text" : "Source"}
            </ModeButton>
          </div>
        </div>
      ) : (
        // The view-mode controls' top row. In rich mode this is the MOBILE home
        // for the pill (sm:hidden — desktop rich merges it into the formatting
        // bar via viewControls). In source/preview there's no formatting bar, so
        // the row shows at every width. Sticky + opaque so it stays reachable and
        // content scrolls cleanly under it on a long note.
        <div
          className={`flex items-center border-b border-line bg-surface-1 px-2 py-1.5 sm:sticky sm:top-[var(--nav-pt,0px)] sm:z-30 ${
            mode === "rich" ? "sm:hidden" : ""
          }`}
        >
          <div className="ml-auto flex items-center gap-1">{viewControls}</div>
        </div>
      )}
      {child}
    </div>
  );
}
