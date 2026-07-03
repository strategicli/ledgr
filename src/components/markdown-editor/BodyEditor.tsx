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
};

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
}: BodyEditorProps) {
  const large = isLargeBody(initialMarkdown);
  // Latest emitted markdown (every mode reports through handleChange).
  const liveText = useRef(initialMarkdown);
  // Content the currently-mounted child is seeded with; only re-snapshotted on a
  // mode switch, so editing within a mode never remounts the child.
  const [mountText, setMountText] = useState(initialMarkdown);
  const [mode, setMode] = useState<Mode>(large ? "preview" : "rich");

  const handleChange = (md: string) => {
    liveText.current = md;
    onChange(md);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMountText(liveText.current);
    setMode(next);
  };

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
        collapsibleToolbar={collapsibleToolbar}
        compact={compact}
        onRequestSave={onRequestSave}
        editable={editable}
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
        // Normal note: a quiet Rich/Source toggle, available on any note.
        <div className="mb-1 flex items-center justify-end gap-1">
          <ModeButton active={mode === "rich"} onClick={() => switchMode("rich")}>
            Rich
          </ModeButton>
          <ModeButton active={mode === "source"} onClick={() => switchMode("source")}>
            Source
          </ModeButton>
        </div>
      )}
      {child}
    </div>
  );
}
