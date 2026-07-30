// Editor-side body comments (ADR-170). The canonical form is CriticMarkup in the
// markdown, {==anchored text==}{>>the note<<}, parsed and rendered by the pure
// module (src/lib/editor/comment-markdown.ts) on every server path. This is the
// Tiptap half: the mark that round-trips that syntax, plus a decoration that
// renders the note as a margin card while editing.
//
// The note rides as a STRING ATTRIBUTE on the mark, not as editable inline
// content. A comment holding real rich content would need a nested editor
// instance for a note to self; instead the note is markdown text edited in one
// textarea, and it renders rich everywhere the body renders (bold, links, and
// native @-mention chips all work inside it, and a mention inside a comment
// creates a real relation because syncMentionRelations reads the raw body).
//
// Why the note is ALSO a widget decoration, not just an attribute: the read view
// gets its `.cmt` + `.cmt-note` sibling pair from renderComments(), and all the
// presentation (the gutter card, the two-way hover coupling, the narrow-viewport
// aside) is CSS keyed to that adjacency. Emitting the same DOM shape here means
// the editor reuses that stylesheet verbatim instead of growing a second one.
"use client";

import { Extension, Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import { litComment } from "./comment-hover";

// Fired on the editor root when the user clicks a comment's margin card (its
// speech-bubble icon on a narrow viewport, which is the same element). The host
// (MarkdownEditor) puts the caret inside that comment's range and opens the
// comment popover on `note`. Carries the note and the run's start rather than
// asking the host to look the mark up: the card is a widget sitting at the run's
// END, and this mark is non-inclusive, so a position lookup there finds no mark.
//
// The card is the ONLY way to open the editor by pointer. A click on the
// underlined text is left alone deliberately — it has to stay an ordinary click
// that places the caret, or commented text can't be edited (Brandon, 2026-07-30).
export const EDIT_COMMENT_EVENT = "ledgr-edit-comment"; // {from, note}

// The mark. Only the RANGED form is claimed here: a point comment ({>>note<<}
// with nothing anchored) has no text to mark, so it stays literal text in the
// editor and still renders correctly in the read view. It round-trips untouched
// because none of { } < > = is in @tiptap/markdown's escape set.
export const Comment = Mark.create({
  name: "comment",

  // Keep a comment out of the way of the marks it commonly overlaps: it must be
  // able to sit inside a highlight (the composed case) without either claiming
  // the other's range.
  inclusive: false,

  addAttributes() {
    return {
      note: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-note") ?? "",
        renderHTML: (attrs) => ({ "data-note": attrs.note ?? "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span.cmt" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "cmt" }), 0];
  },

  renderMarkdown(node, helpers) {
    const content = helpers.renderChildren(node);
    const note = String(node.attrs?.note ?? "");
    return `{==${content}==}{>>${note}<<}`;
  },

  // Reclaim the CriticMarkup pair at the inline level, the same reason TextColor
  // and Highlight do: the default path would treat the run as opaque text and
  // flatten any **bold**/*italic* inside the anchored range. Capturing the inner
  // markdown and re-tokenizing it keeps nested formatting across a rich⇄source
  // flip.
  //
  // NOTE: `comment` must stay OUT of HTML_WRAPPED_MARKS (extensions.ts). That set
  // un-escapes text inside marks that emit RAW INLINE HTML, because their parse
  // side reads content back as literal text. This mark emits CriticMarkup, so its
  // content is genuinely markdown and genuinely needs the serializer's normal
  // escaping. Adding it there "for consistency" would break bold inside a
  // commented phrase.
  markdownTokenizer: {
    name: "comment",
    level: "inline" as const,
    start: (src: string) => {
      const i = src.indexOf("{==");
      return i < 0 ? src.length : i;
    },
    tokenize: (src: string) => {
      const m = /^\{==([^\n]*?)==\}[ \t]*\{>>([^\n]*?)<<\}/.exec(src);
      if (!m) return undefined;
      return { type: "comment", raw: m[0], note: m[2], inner: m[1] };
    },
  },

  parseMarkdown(token, helpers) {
    // tokenizeInline is always present at runtime; the type marks it optional.
    const inner = helpers.parseInline(helpers.tokenizeInline?.(token.inner) ?? []);
    return helpers.applyMark("comment", inner, { note: token.note });
  },
});

// The margin card for one comment: the same `.cmt-note` element renderComments()
// emits, so it picks up the identical stylesheet. contentEditable=false keeps
// ProseMirror from treating it as document text, and the mousedown guard stops a
// click on the card from moving the selection out of the comment it belongs to.
function noteCard(note: string, from: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "cmt-note";
  // The same identity attribute the mark renders on the anchored text, so the
  // card is part of its comment's hover group (comment-hover.ts) and the outline
  // can find every segment the card speaks for.
  el.dataset.note = note;
  el.textContent = note || "Empty comment";
  el.contentEditable = "false";
  el.title = "Click to edit this comment";
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dispatchEvent(
      new CustomEvent(EDIT_COMMENT_EVENT, { detail: { from, note }, bubbles: true })
    );
  });
  return el;
}

// One logical comment: `from`/`to` cover every segment of it, `cardAt` is where
// its single margin card goes.
type CommentRun = { note: string; from: number; to: number; cardAt: number };

// Every comment in the doc, in document order, ONE entry per logical comment.
//
// BRIDGING (Brandon, 2026-07-30): a comment must be able to run past the end of a
// line without becoming several comments. Block structure and hard breaks
// therefore do NOT end a run — only inline content that carries a different note
// (or none) does. That's the editor half of the rule comment-markdown.ts states in
// full: the note text IS the comment's identity, and the markdown underneath is
// one CriticMarkup pair per line because an inline pair can't cross a block
// boundary.
//
// `cardAt` freezes at the end of the run's FIRST LINE, so a bridged comment's card
// hangs off the line it starts on (and the read view, which emits its card after
// the first pair, agrees). Within a single line the card still lands after the
// whole phrase, so a comment split by a **bold** word keeps one card at its end.
function commentRuns(doc: PMNode): CommentRun[] {
  const runs: CommentRun[] = [];
  let open: CommentRun | null = null;
  let sealed = false; // the first line of `open` has ended
  doc.descendants((node, pos) => {
    if (node.isBlock || node.type.name === "hardBreak") {
      // Structure, not content: it's exactly what a bridged comment spans. The
      // card stops following the run here.
      if (open) sealed = true;
      return true;
    }
    const mark: PMMark | undefined = node.marks.find((m) => m.type.name === "comment");
    if (!mark) {
      open = null;
      return false;
    }
    const note = String(mark.attrs.note ?? "");
    const end = pos + node.nodeSize;
    if (open && open.note === note) {
      open.to = end;
      if (!sealed) open.cardAt = end;
    } else {
      open = { note, from: pos, to: end, cardAt: end };
      sealed = false;
      runs.push(open);
    }
    return false;
  });
  return runs;
}

// The comment containing `at`, or null. Used to extend an edit or a delete over
// EVERY segment of a bridged comment: Tiptap's own extendMarkRange is bounded to
// one textblock (getMarkRange walks $pos.parent), so it would rewrite the
// paragraph the caret is in and leave the rest of the comment behind with the old
// note.
export function commentRangeAt(doc: PMNode, at: number): { from: number; to: number } | null {
  const run = commentRuns(doc).find((r) => at >= r.from && at <= r.to);
  return run ? { from: run.from, to: run.to } : null;
}

// One widget per comment, placed so the card lands as an anchor's next sibling in
// the DOM — which is what the `+` / `:has(+ …)` CSS pairing depends on.
function buildDecorations(doc: PMNode): DecorationSet {
  const decos = commentRuns(doc).map((run) =>
    Decoration.widget(run.cardAt, () => noteCard(run.note, run.from), {
      side: 1,
      ignoreSelection: true,
      key: `cmt-${run.from}-${run.cardAt}`,
    })
  );
  return DecorationSet.create(doc, decos);
}

const commentKey = new PluginKey("commentCards");

// Registered alongside the mark. Decorations plus hover: clicks are handled at the
// DOM level by the host, because a ProseMirror position lookup at a run boundary
// finds no non-inclusive mark and the card is a widget sitting exactly there.
export const CommentCards = Extension.create({
  name: "commentCards",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentKey,
        props: {
          decorations: (state) => buildDecorations(state.doc),
          // Hovering any segment of a bridged comment lights up all of them and
          // its card. Read-only handlers (always return false) — they touch
          // classes, never the document.
          handleDOMEvents: {
            mouseover: (view, event) => {
              litComment(view.dom, event.target);
              return false;
            },
            mouseleave: (view) => {
              litComment(view.dom, null);
              return false;
            },
          },
        },
      }),
    ];
  },
});

// The note on the comment under the current selection, or null when there isn't
// one. Reads Tiptap's own active-mark attributes, which follow the selection the
// way the toolbar's other state does.
export function commentNoteAt(editor: Editor): string | null {
  if (!editor.isActive("comment")) return null;
  return String(editor.getAttributes("comment").note ?? "");
}

// The range one edit or delete applies to: every segment of the comment at `at`,
// falling back to Tiptap's textblock-bounded extendMarkRange when `at` isn't
// inside a comment after all.
//
// `at` is a position known to be INSIDE an existing comment (the card carries its
// run's start). Passing it and extending from there is what makes an edit rewrite
// the whole comment rather than a fragment of it — the caret alone is not enough to
// rely on, because this mark is non-inclusive and focus has moved to the note's
// textarea in between.
function selectComment(editor: Editor, at: number) {
  const range = commentRangeAt(editor.state.doc, at);
  const chain = editor.chain().focus();
  return range ? chain.setTextSelection(range) : chain.setTextSelection(at).extendMarkRange("comment");
}

// Apply (or update) a comment. Without `at` this is the create path, and the
// current (non-empty) selection is the range being commented — a selection that
// spans blocks is fine and becomes ONE bridged comment, since every block it
// covers gets the same note.
export function setComment(editor: Editor, note: string, at?: number): void {
  const chain = at !== undefined ? selectComment(editor, at) : editor.chain().focus();
  chain.setMark("comment", { note }).run();
}

// Remove the comment, keeping the text it annotated (delete IS resolve, ADR-170).
export function removeComment(editor: Editor, at?: number): void {
  const chain =
    at !== undefined ? selectComment(editor, at) : editor.chain().focus().extendMarkRange("comment");
  chain.unsetMark("comment").run();
}
