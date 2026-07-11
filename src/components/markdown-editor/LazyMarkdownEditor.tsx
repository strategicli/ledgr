// The only way a page may pull in the Tiptap editor: a client-side dynamic
// import, so lists and other surfaces never pay the editor bundle (CLAUDE.md
// rule 8 / PRD §6.4). Mirrors LazyEditor for the BlockNote path.
//
// Reading-first (perceived speed): when `readingFirst` is set (the item-body
// path — BodyEditor / TabbedBody), a body opens as server-rendered HTML
// (MarkdownPreview, a light /api/render-markdown fetch) and only mounts the
// heavy Tiptap bundle when the user actually edits. So opening a note to read
// paints the body immediately instead of showing "Loading editor…" over a
// blank area while the editor chunk downloads. Callers that need the live
// editor from the first frame (CollabNotes' onEditorReady, the scratch canvas)
// leave `readingFirst` off and get the original direct mount.
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { MarkdownEditorProps } from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";

const TiptapEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="px-4 py-3 text-sm text-neutral-400">Loading editor…</div>
    ),
  }
);

// Warm the Tiptap chunk without mounting it, so the click-to-edit swap is
// instant. webpack dedupes this against the dynamic() import above.
function preloadEditor() {
  void import("./MarkdownEditor");
}

type Props = MarkdownEditorProps & {
  // Opt in to the reading-first behavior (see file header). Off by default so
  // existing callers keep the plain direct mount.
  readingFirst?: boolean;
};

export default function LazyMarkdownEditor({ readingFirst, ...props }: Props) {
  // Two cases skip straight to the editor even under readingFirst, because
  // reading-first buys nothing there: an empty body (a new note — the user
  // wants to type now, with the placeholder) and a locked/read-only body (kept
  // on the direct path so locked-item rendering — deep-link scroll, mention
  // chips — is untouched, and because there is no edit interaction to swap on).
  const eligible =
    !!readingFirst && props.editable !== false && !!props.initialMarkdown.trim();
  const [edit, setEdit] = useState(!eligible);
  // Focus the editor once it mounts, but only when the swap was a deliberate
  // click/focus into the body — so opening a note to read never steals focus or
  // pops the mobile keyboard. (State, not a ref: it's read during render.)
  const [focusOnMount, setFocusOnMount] = useState(false);

  // Preload the editor chunk after hydration so the swap into edit mode is
  // instant. requestIdleCallback keeps it off the critical open path.
  useEffect(() => {
    if (edit) return;
    let cancelled = false;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => {
        if (!cancelled) preloadEditor();
      });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(preloadEditor, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [edit]);

  // Deep link to a line (#^id, ADR-090): the scroll-to-and-flash lives in the
  // editor's own mount effect, so a preview-only body would never jump. When we
  // arrive on such a hash, mount the editor (without stealing focus) so it can
  // do the scroll. Deferred (post-hydration) rather than keyed into the initial
  // state, so the server render — which has no window — and the client agree.
  useEffect(() => {
    if (edit) return;
    if (!/^#\^/.test(window.location.hash)) return;
    const t = setTimeout(() => setEdit(true), 0);
    return () => clearTimeout(t);
  }, [edit]);

  if (edit) {
    return <TiptapEditor {...props} autoFocus={focusOnMount} />;
  }

  const enterEdit = () => {
    setFocusOnMount(true);
    setEdit(true);
  };

  return (
    // Reading shell: a click/tap anywhere in the body (except on a link, which
    // should navigate) or keyboard focus swaps in the live editor. `onClick`
    // (not pointerdown) so a touch scroll-gesture doesn't trip the swap; the
    // right-click Send-to-Desk menu on the preview is left alone (no click).
    <div
      tabIndex={0}
      className="cursor-text outline-none"
      onClick={(e) => {
        if ((e.target as Element).closest?.("a")) return; // let links navigate
        enterEdit();
      }}
      onFocus={(e) => {
        // Only the shell itself gaining focus (keyboard tab-in); ignore focus
        // bubbling up from a link inside the rendered body.
        if (e.target === e.currentTarget) enterEdit();
      }}
    >
      <MarkdownPreview text={props.initialMarkdown} itemId={props.itemId} />
    </div>
  );
}
