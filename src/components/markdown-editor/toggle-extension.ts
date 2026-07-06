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
  matchToggleBlock,
  nextToggleStart,
  toggleToMarkdown,
} from "@/lib/editor/toggle-markdown";

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
      chevron.textContent = "▸";
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
