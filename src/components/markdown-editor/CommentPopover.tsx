// The popup form of a body comment (ADR-170, reworked 2026-07-30). One panel
// shared by both surfaces: the editor opens it with a textarea, the read view
// opens it read-only with the note's already-rendered HTML.
//
// WHY A POPUP AND NOT A ROW UNDER THE TOOLBAR (the shape this replaces): the row
// lived at the top of the editor, so opening a comment 40 lines down scrolled the
// document to the top — the note you were annotating left the screen. A panel
// that opens where the comment already is never moves the reader.
//
// TWO POSITIONS, one rule: if the margin gutter exists (≥1024px, the same
// breakpoint markdown-editor.css floats the cards at) and the host gave us a
// point, the panel opens right there in the margin — you edit the card where it
// sits. Otherwise (phone, slim panel, or no anchor point) it's a true popup: a
// fixed card over the content with a scrim behind it.
//
// `at` is in the HOST WRAPPER's coordinate space, not the viewport, and the panel
// is absolutely positioned inside it — so it scrolls with the document instead of
// detaching from its comment the moment the page moves.
"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "./useIsDesktop";

// Matches the gutter breakpoint in markdown-editor.css. Below it there is no
// margin to edit in, so the panel becomes a popup.
const GUTTER = "(min-width: 1024px)";

// The owner's comment display (User Settings → Appearance), stamped on <body> by
// the root layout. "icons" means no gutter at any width, so every comment opens
// as a popup, the same as on a phone.
export const commentsAsIcons = () =>
  typeof document !== "undefined" && document.body.dataset.comments === "icons";

// Flip the comment display for the whole app: live on this page (the CSS reads
// the body attribute), saved for the next load.
function toggleCommentDisplay() {
  const next = commentsAsIcons() ? "margin" : "icons";
  document.body.dataset.comments = next;
  void fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commentDisplay: next }),
  });
}

export default function CommentPopover({
  value,
  html,
  editable,
  at,
  canDelete,
  onChange,
  onSave,
  onDelete,
  onClose,
  onDismiss,
}: {
  // The note's markdown (the editable form).
  value: string;
  // The note's rendered HTML (the read-only form). Ignored when editable.
  html?: string;
  editable: boolean;
  // Where the panel opens on a wide screen, relative to the host wrapper (which
  // must be position:relative). null → always the fixed popup.
  at: { top: number; left: number } | null;
  canDelete?: boolean;
  onChange?: (note: string) => void;
  onSave?: () => void;
  onDelete?: () => void;
  // Explicit cancel: Escape and the ✕. Discards the draft.
  onClose: () => void;
  // Clicking away. Separate from onClose because the gutter panel sits over a
  // live document you're meant to keep clicking — dropping a typed note on every
  // stray click would make it a trap. Defaults to onClose.
  onDismiss?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Frozen at open: flipping the display from this panel re-lays the page behind
  // it, but the open panel stays where it is instead of jumping.
  const [asIcons, setAsIcons] = useState(commentsAsIcons);
  const [frozenIcons] = useState(asIcons);
  const inGutter = useMediaQuery(GUTTER) && at !== null && !frozenIcons;
  const displaySwitch = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        toggleCommentDisplay();
        setAsIcons(!asIcons);
      }}
      title={
        asIcons
          ? "Show comments as cards in the right margin (wide screens)"
          : "Show comments as small icons in the text, so the page keeps its full width"
      }
      className="rounded px-2 py-1 text-xs text-ink-faint hover:bg-surface-3 hover:text-ink-muted"
    >
      {asIcons ? "Show in margin" : "Show as icons"}
    </button>
  );
  const dismiss = onDismiss ?? onClose;

  // Escape cancels; a click outside dismisses. The scrim covers the outside case
  // in popup mode, but the gutter panel has no scrim (the document stays live
  // behind it), so it needs the listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) dismiss();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose, dismiss]);

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Comment"
      style={inGutter && at ? { top: at.top, left: at.left } : undefined}
      className={
        "rounded-card border border-line-strong bg-surface-2 p-2 shadow-xl shadow-black/40 " +
        (inGutter
          ? "absolute z-40 w-52"
          : "fixed inset-x-3 top-16 z-[61] mx-auto max-w-md")
      }
    >
      {editable ? (
        <>
          <textarea
            autoFocus
            rows={3}
            value={value}
            placeholder="Note to self… (markdown works, @-mentions too)"
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSave?.();
              }
            }}
            className="w-full resize-y rounded bg-surface-1 px-2 py-1 text-[13px] leading-snug text-ink placeholder:text-ink-faint"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onSave}
              title="Save (⌘/Ctrl+Enter)"
              className="rounded bg-neutral-700 px-2 py-1 text-xs font-medium text-ink hover:bg-neutral-600"
            >
              Save
            </button>
            {canDelete && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onDelete}
                title="Delete this comment (the text it points at stays)"
                className="rounded px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-3 hover:text-ink"
              >
                Delete
              </button>
            )}
            {displaySwitch}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClose}
              title="Cancel (Esc)"
              aria-label="Cancel"
              className="ml-auto rounded px-2 py-1 text-xs text-ink-faint hover:bg-surface-3 hover:text-ink-muted"
            >
              ✕
            </button>
          </div>
        </>
      ) : (
        // Read-only: the note's own rendered HTML, so bold, links, and mention
        // chips look exactly as they do in the margin card. Same trust basis as
        // the rest of MarkdownPreview (the owner's own content).
        <>
          <div
            className="ledgr-prose ledgr-prose-compact !text-[13px] !leading-snug [&>*]:my-0"
            dangerouslySetInnerHTML={{ __html: html ?? "" }}
          />
          <div className="mt-1.5 flex justify-end">{displaySwitch}</div>
        </>
      )}
    </div>
  );

  // Popup mode gets a scrim: it's a foreground panel over the body text, and on
  // touch the scrim is also the dismiss target.
  if (inGutter) return panel;
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={dismiss} />
      {panel}
    </>
  );
}
