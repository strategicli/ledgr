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

// Fired on the editor root when the user clicks a comment's margin card. The host
// (MarkdownEditor) puts the caret inside that comment's range and opens its editor
// row on `note`. Carries the note and the run's start rather than asking the host
// to look the mark up: the card is a widget sitting at the run's END, and this mark
// is non-inclusive, so a position lookup there finds no mark. A click on the
// comment's underlined TEXT needs no event — it places the caret itself, and the
// host reads the note straight off the span's data-note attribute.
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

// One widget per comment-marked run, placed at the run's END so the card lands as
// the anchor's next sibling in the DOM — which is what the `+` / `:has(+ …)` CSS
// pairing depends on. Adjacent text nodes carrying the SAME mark instance are one
// run (a comment split by a bold word inside it would otherwise get two cards).
function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  let open: { mark: PMMark; from: number; end: number } | null = null;
  const flush = () => {
    if (!open) return;
    const { mark, from, end } = open;
    const note = String(mark.attrs.note ?? "");
    decos.push(
      Decoration.widget(end, () => noteCard(note, from), {
        side: 1,
        ignoreSelection: true,
        key: `cmt-${from}-${end}`,
      })
    );
    open = null;
  };
  doc.descendants((node, pos) => {
    if (!node.isText) {
      // A non-text node (image, mention chip, or a block boundary) ends the run.
      flush();
      return true;
    }
    const mark = node.marks.find((m) => m.type.name === "comment");
    if (!mark) {
      flush();
      return false;
    }
    if (open && open.mark.eq(mark)) {
      open.end = pos + node.nodeSize; // same comment continues
    } else {
      flush();
      open = { mark, from: pos, end: pos + node.nodeSize };
    }
    return false;
  });
  flush();
  return DecorationSet.create(doc, decos);
}

const commentKey = new PluginKey("commentCards");

// Registered alongside the mark. Decorations only: clicks are handled at the DOM
// level by the host, because a ProseMirror position lookup at a run boundary finds
// no non-inclusive mark and the card is a widget sitting exactly there.
export const CommentCards = Extension.create({
  name: "commentCards",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentKey,
        props: { decorations: (state) => buildDecorations(state.doc) },
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

// Apply (or update) a comment.
//
// `at` is a position known to be INSIDE an existing comment (the editing paths
// supply it: the card carries its run's start, and a click on the underlined text
// resolves the span's own position). Passing it and then extending to the mark's
// range is what makes an edit rewrite the whole comment rather than a fragment of
// it — the caret alone is not enough to rely on, because this mark is
// non-inclusive and focus has moved to the note's textarea in between.
//
// Without `at` this is the create path, and the current (non-empty) selection is
// the range being commented.
export function setComment(editor: Editor, note: string, at?: number): void {
  const chain = editor.chain().focus();
  if (at !== undefined) chain.setTextSelection(at).extendMarkRange("comment");
  chain.setMark("comment", { note }).run();
}

// Remove the comment, keeping the text it annotated (delete IS resolve, ADR-170).
export function removeComment(editor: Editor, at?: number): void {
  const chain = editor.chain().focus();
  if (at !== undefined) chain.setTextSelection(at);
  chain.extendMarkRange("comment").unsetMark("comment").run();
}

// The document position just inside a rendered `.cmt` span, for the click paths.
export function posInCommentSpan(editor: Editor, span: HTMLElement): number | null {
  try {
    return editor.view.posAtDOM(span, 0) + 1;
  } catch {
    return null;
  }
}
