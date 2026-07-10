// The collapsible "toggle" block (a <details>/<summary> disclosure) — the first
// bespoke BLOCK node with its own markdown contract (colors/mentions/images are
// inline; tables are the other block, but GFM has native table syntax). Three
// nodes mirror the HTML: `toggle` wraps a `toggleSummary` (the always-visible
// heading line) and a `toggleContent` (the block body shown when open).
//
// Markdown round-trip (ADR: extends the canonical body dialect with a <details>
// block; the format is CORE — both-agree + ADR, CLAUDE.md):
//   - out: renderMarkdown on `toggle` emits the canonical shape (toggle-markdown.ts).
//   - in:  a custom BLOCK tokenizer claims the whole <details>…</details> span
//          before marked's html-block rule can split it at the inner blank line,
//          then parseMarkdown rebuilds the subtree via the manager's block/inline
//          child parsers (helpers.parseBlockChildren / parseInline).
// The node type is always registered so existing bodies with toggles parse even
// when the "create toggles" setting is off; that setting only gates the toolbar
// button and the "/toggle" slash command (the creation affordances).
"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { type ResolvedPos, type Node as PMNode } from "@tiptap/pm/model";
import {
  matchToggleBlock,
  nextToggleStart,
  toggleToMarkdown,
} from "@/lib/editor/toggle-markdown";

// The depth at which `$from` sits inside a toggleSummary, or null. Used by the
// Enter/Backspace handlers to know when the caret is on a toggle's heading line.
function summaryDepth($from: ResolvedPos): number | null {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "toggleSummary") return d;
  }
  return null;
}

// Enter on the summary (heading) line: move the caret DOWN into the body's first
// block instead of trying to split the single-line summary (the schema can't
// split it, which produced a stray node). Returns null when the caret isn't on
// a toggle summary, so normal Enter applies elsewhere. Pure → node-testable.
export function toggleEnterToBody(state: EditorState): Transaction | null {
  const sel = state.selection;
  // Only a collapsed caret; a range/node selection falls through to defaults.
  // (Checking `empty` rather than `instanceof TextSelection` avoids the
  // cross-module-copy instanceof trap and is enough here.)
  if (!sel.empty) return null;
  const d = summaryDepth(sel.$from);
  if (d == null) return null;
  const toggleDepth = d - 1;
  const togglePos = sel.$from.before(toggleDepth);
  const summaryNode = sel.$from.node(toggleDepth).child(0);
  // Nearest text position at the start of the body (toggleContent's first
  // block) — robust to the first block being a list rather than a paragraph.
  const contentBefore = togglePos + 1 + summaryNode.nodeSize;
  const $pos = state.doc.resolve(
    Math.min(contentBefore + 1, state.doc.content.size)
  );
  return state.tr.setSelection(TextSelection.near($pos, 1)).scrollIntoView();
}

// Backspace at the very start of the summary: UNWRAP the toggle (summary becomes
// a paragraph, body blocks follow) so a toggle can be removed while editing —
// otherwise `isolating` traps the caret and there's no way out. Returns null
// unless the caret is at offset 0 of a toggle summary. Pure → node-testable.
export function toggleBackspaceUnwrap(state: EditorState): Transaction | null {
  const sel = state.selection;
  // Only a collapsed caret; a range/node selection falls through to defaults.
  // (Checking `empty` rather than `instanceof TextSelection` avoids the
  // cross-module-copy instanceof trap and is enough here.)
  if (!sel.empty) return null;
  if (sel.$from.parentOffset !== 0) return null; // only at the summary start
  const d = summaryDepth(sel.$from);
  if (d == null) return null;
  const toggleDepth = d - 1;
  const togglePos = sel.$from.before(toggleDepth);
  const toggleNode = sel.$from.node(toggleDepth);
  const summaryNode = toggleNode.child(0);
  const contentNode = toggleNode.child(1);
  const paragraph = state.schema.nodes.paragraph.create(
    null,
    summaryNode.content
  );
  // Prepend via the body Fragment's own method (no cross-module Fragment import,
  // which also dodges the multi-copy "Fragment.from" identity trap).
  const replacement = contentNode.content.addToStart(paragraph);
  const tr = state.tr.replaceWith(
    togglePos,
    togglePos + toggleNode.nodeSize,
    replacement
  );
  tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
  return tr.scrollIntoView();
}

// The always-visible heading line. inline* (so it can be empty on insert), and
// it renders as a real <summary> so getHTML()/clipboard produce valid markup.
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: "summary" }, { tag: "div.ledgr-toggle-summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "summary",
      mergeAttributes(HTMLAttributes, { class: "ledgr-toggle-summary" }),
      0,
    ];
  },
});

// The collapsible body. block+ so any block content lives inside. The
// data-toggle-content attribute scopes parseHTML so a bare <div> paste can't be
// mistaken for toggle content.
export const ToggleContent = Node.create({
  name: "toggleContent",
  content: "block+",
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: "div[data-toggle-content]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-toggle-content": "true",
        class: "ledgr-toggle-content",
      }),
      0,
    ];
  },
});

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary toggleContent",
  isolating: true,
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      // Open/closed is persisted (<details open>) so a note reopens the way it
      // was left. Parsed from the presence of the `open` attribute on the tag.
      open: {
        default: true,
        parseHTML: (el) => (el as HTMLElement).hasAttribute("open"),
        renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },

  // Plain-DOM NodeView (no popup/React dependency, Principle 5). The editing DOM
  // is a div, NOT a native <details> — a real <details> hides its content from
  // ProseMirror's selection/coords machinery. A contentEditable=false chevron
  // flips the `open` attribute; CSS (markdown-editor.css) hides the content when
  // data-open="false". contentDOM holds BOTH child nodes (summary + content).
  addNodeView() {
    return ({ editor, node, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "ledgr-toggle";
      dom.dataset.open = node.attrs.open ? "true" : "false";

      const chevron = document.createElement("button");
      chevron.type = "button";
      chevron.className = "ledgr-toggle-chevron";
      chevron.contentEditable = "false";
      chevron.setAttribute("aria-label", "Expand or collapse");
      // The glyph is a nested span so CSS rotates the glyph in place — the button
      // itself is an enlarged (touch-friendly) hit area that must not rotate.
      const glyph = document.createElement("span");
      glyph.className = "ledgr-toggle-chevron-glyph";
      glyph.textContent = "▸";
      chevron.appendChild(glyph);
      chevron.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      chevron.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...cur.attrs,
            open: !cur.attrs.open,
          })
        );
      });

      const body = document.createElement("div");
      body.className = "ledgr-toggle-body";

      dom.append(chevron, body);

      return {
        dom,
        contentDOM: body,
        update: (updated) => {
          if (updated.type.name !== "toggle") return false;
          dom.dataset.open = updated.attrs.open ? "true" : "false";
          return true;
        },
        // Chrome (the chevron) lives outside contentDOM; ignore its mutations so
        // ProseMirror doesn't try to read them as content. Selection mutations
        // and everything inside the body still go to ProseMirror. (Cast to the
        // DOM element type — `Node` here is Tiptap's extension class.)
        ignoreMutation: (m) =>
          m.type !== "selection" && !body.contains(m.target as HTMLElement),
        stopEvent: (e) => chevron.contains(e.target as HTMLElement),
      };
    };
  },

  // Keyboard behavior on the summary (heading) line — the commands are pure
  // (state → Transaction | null) so they're node-testable without a DOM; the
  // shortcuts just dispatch them.
  addKeyboardShortcuts() {
    const run = (fn: (state: EditorState) => Transaction | null) => () => {
      const tr = fn(this.editor.state);
      if (!tr) return false;
      this.editor.view.dispatch(tr);
      return true;
    };
    return { Enter: run(toggleEnterToBody), Backspace: run(toggleBackspaceUnwrap) };
  },

  // out → the canonical <details> shape. renderChildren walks each child node's
  // content: the summary's inline markdown and the content's block markdown.
  renderMarkdown(node, helpers) {
    const content = (node as { content?: unknown[] }).content ?? [];
    const summaryNode = content[0];
    const contentNode = content[1];
    // Summary is inline — concatenate (default ""). Body is block content, so
    // its children must be separated by a blank line, or consecutive paragraphs
    // fuse into one on the round-trip ("Para one.Para two.").
    const render = helpers.renderChildren as (
      node: unknown,
      separator?: string
    ) => string;
    const summaryMd = summaryNode ? render(summaryNode) : "";
    const bodyMd = contentNode ? render(contentNode, "\n\n") : "";
    return toggleToMarkdown(summaryMd, bodyMd, !!node.attrs?.open);
  },

  // A block-level tokenizer: `helper.inlineTokens` / `helper.blockTokens`
  // (built from marked's lexer) turn the captured summary/body markdown into
  // tokens that parseMarkdown converts to nodes.
  markdownTokenizer: {
    name: "toggle",
    level: "block",
    start: (src: string) => nextToggleStart(src),
    tokenize: (
      src: string,
      _tokens: unknown,
      helper: {
        inlineTokens: (s: string) => unknown[];
        blockTokens: (s: string) => unknown[];
      }
    ) => {
      const m = matchToggleBlock(src);
      if (!m) return undefined;
      return {
        type: "toggle",
        raw: m.raw,
        toggleOpen: m.open,
        summaryTokens: helper.inlineTokens(m.summary),
        bodyTokens: helper.blockTokens(m.body),
      };
    },
  },

  parseMarkdown(token, helpers) {
    const t = token as {
      toggleOpen?: boolean;
      summaryTokens?: unknown[];
      bodyTokens?: unknown[];
    };
    const summary = helpers.parseInline?.((t.summaryTokens ?? []) as never) ?? [];
    let body =
      helpers.parseBlockChildren?.((t.bodyTokens ?? []) as never) ?? [];
    // toggleContent is block+, so an empty body would be an invalid document —
    // seed an empty paragraph.
    if (!Array.isArray(body) || body.length === 0) {
      body = [helpers.createNode("paragraph", null, [])];
    }
    return helpers.createNode("toggle", { open: !!t.toggleOpen }, [
      helpers.createNode("toggleSummary", null, summary),
      helpers.createNode("toggleContent", null, body),
    ]);
  },
});

// Insert a fresh, empty, open toggle at the selection and drop the cursor into
// the summary line so the user can type its title immediately. Shared by the
// toolbar button and the "/toggle" slash command.
export function insertToggle(editor: Editor): void {
  const at = editor.state.selection.from;
  editor
    .chain()
    .focus()
    .insertContentAt(at, {
      type: "toggle",
      attrs: { open: true },
      content: [
        { type: "toggleSummary" },
        { type: "toggleContent", content: [{ type: "paragraph" }] },
      ],
    })
    .run();
  // The summary's inline content opens two positions past the toggle's start
  // (enter the toggle, then the summary). Best-effort: if the math lands out of
  // range the caret just stays where insert left it, still inside the block.
  const target = at + 2;
  if (target <= editor.state.doc.content.size) {
    editor.chain().setTextSelection(target).run();
  }
}

// Convert the current block(s)/selection INTO a toggle (as opposed to inserting a
// fresh empty one): the first selected top-level block's inline text becomes the
// summary line, the remaining block(s) become its content (an empty paragraph
// when only a single block was wrapped, since toggleContent is block+). When the
// first block isn't a textblock (a list, a blockquote), the summary starts empty
// and every wrapped block goes into the content. Returns false when it can't wrap
// — a selection already inside a toggle (don't nest a toggle in itself), or no
// block to wrap — so callers (toolbar, slash menu) can fall back to insertToggle.
// The node shape it builds is exactly what parse/serialize already round-trip, so
// the markdown contract is unchanged.
export function wrapSelectionInToggle(editor: Editor): boolean {
  const { state } = editor;
  const { schema, selection } = state;
  const toggleType = schema.nodes.toggle;
  const summaryType = schema.nodes.toggleSummary;
  const contentType = schema.nodes.toggleContent;
  const paragraphType = schema.nodes.paragraph;
  if (!toggleType || !summaryType || !contentType || !paragraphType) return false;

  const { $from, $to } = selection;
  if ($from.depth < 1) return false;
  // Already inside a toggle: bail so the caller inserts a fresh empty one rather
  // than nesting a toggle within itself.
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "toggle") return false;
  }

  // The whole top-level blocks the selection touches (before the first, after the
  // last) — so a partial selection still wraps entire blocks, never a fragment.
  const from = $from.before(1);
  const to = $to.after(1);
  const blocks: PMNode[] = [];
  state.doc.slice(from, to).content.forEach((node) => blocks.push(node));
  if (blocks.length === 0) return false;

  const first = blocks[0];
  const firstIsTextblock = first.isTextblock;
  const summary = summaryType.create(
    null,
    firstIsTextblock ? first.content : undefined
  );
  const contentBlocks = firstIsTextblock ? blocks.slice(1) : blocks;
  if (contentBlocks.length === 0) contentBlocks.push(paragraphType.create());
  const toggle = toggleType.create({ open: true }, [
    summary,
    contentType.create(null, contentBlocks),
  ]);

  const tr = state.tr.replaceRangeWith(from, to, toggle);
  // Drop the caret into the summary line so its title is immediately editable
  // (two positions in: enter the toggle, then the summary).
  const summaryPos = Math.min(from + 2, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(summaryPos), 1)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}
