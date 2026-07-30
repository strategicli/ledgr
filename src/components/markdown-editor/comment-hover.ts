// Hover coupling for a comment that BRIDGES lines (ADR-170 follow-on).
//
// markdown-editor.css pairs an anchor with its card using `+` and `:has()`, which
// is why comments need no ids — but a sibling selector cannot reach a segment
// sitting in another paragraph or list item. A bridged comment is several spans in
// several blocks, and hovering any one of them (or its single card) has to light
// up all of them, so that last hop is one class toggle instead.
//
// The key is `data-note`, the attribute the editor's mark already renders and
// renderComments now emits too: the same string that makes two runs one comment.
// One helper serves both surfaces (the read view's delegated handlers and the
// editor's ProseMirror plugin), so there is exactly one definition of "the same
// comment".
"use client";

export const LIT_CLASS = "cmt-lit";

// Light the comment `target` is inside, and unlight every other one. Passing a
// target outside any comment (or null, on mouseleave) clears the whole root.
//
// Re-reading the DOM per hover rather than caching nodes: in the editor these are
// ProseMirror-owned spans and widget decorations, which it replaces freely (the
// same discipline FloatingToc's liveEls follows). A body has a handful of
// comments, and mouseover only fires when the hovered element changes.
export function litComment(root: HTMLElement | null, target: EventTarget | null): void {
  if (!root) return;
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-note]") : null;
  const key = el?.dataset.note;
  const marked = root.querySelectorAll<HTMLElement>("[data-note]");
  // Nothing to light and nothing lit: the common case while the pointer moves
  // over ordinary prose.
  if (key === undefined && !root.querySelector(`.${LIT_CLASS}`)) return;
  for (const node of marked) {
    node.classList.toggle(LIT_CLASS, key !== undefined && node.dataset.note === key);
  }
}
