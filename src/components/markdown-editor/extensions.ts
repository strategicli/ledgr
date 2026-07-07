// Ledgr's bespoke Tiptap extensions: the two color marks and the mention
// node, each wired to emit the exact markdown the v0.17 serializer produced
// (so the M4 migration and existing exports agree on one shape). The hard
// encode/decode logic lives in pure, node-tested helpers (src/lib/colors.ts,
// src/lib/editor/mention-markdown.ts); these extensions only bind Tiptap's
// renderMarkdown / parseHTML hooks to them. Markdown is the source of truth
// (ADR-037), so every renderMarkdown here is part of the canonical contract.
"use client";

import { Mark, Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  BLOCKNOTE_COLORS,
  highlightColorName,
  highlightTag,
  isBlockNoteColor,
  textColorName,
  textColorTag,
} from "@/lib/colors";
import {
  MENTION_URI_PREFIX,
  mentionToMarkdown,
} from "@/lib/editor/mention-markdown";
import {
  imageAttrsFromToken,
  imageToMarkdown,
  type ImageToken,
} from "@/lib/editor/image-markdown";
import {
  formatPassageRef,
  parsePassageSlug,
  passageSlug,
  passageToMarkdown,
} from "@/lib/passages/ref";
import { tableToGfm } from "@/lib/editor/table-markdown";
import { createMentionNodeView } from "./mention-node-view";

// Text color → <span style="color:#hex"> (markdown) / styled span (editor DOM).
export const TextColor = Mark.create({
  name: "textColor",

  addAttributes() {
    return {
      // The palette name (e.g. "red"); the hex is derived so the single
      // table in colors.ts stays authoritative. Not emitted as its own
      // attribute — the style carries it.
      color: { default: null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[style]",
        getAttrs: (el) => {
          const name = textColorName(
            (el as HTMLElement).getAttribute("style") || ""
          );
          return name ? { color: name } : false;
        },
      },
    ];
  },

  renderHTML({ mark }) {
    const color = mark.attrs.color;
    const style = isBlockNoteColor(color)
      ? `color:${BLOCKNOTE_COLORS[color].text}`
      : undefined;
    return ["span", style ? mergeAttributes({ style }) : {}, 0];
  },

  renderMarkdown(node, helpers) {
    const content = helpers.renderChildren(node);
    const color = node.attrs?.color;
    if (!isBlockNoteColor(color)) return content;
    const tag = textColorTag(color);
    return `${tag.open}${content}${tag.close}`;
  },
});

// Highlight → <mark class="hl-name" style="background-color:#hex">. The class
// is the primary parse hook (unambiguous); the style keeps the exact color.
export const Highlight = Mark.create({
  name: "highlight",

  addAttributes() {
    return {
      color: { default: null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark",
        getAttrs: (el) => {
          const node = el as HTMLElement;
          const name = highlightColorName(
            node.getAttribute("class"),
            node.getAttribute("style")
          );
          return name ? { color: name } : {};
        },
      },
    ];
  },

  renderHTML({ mark }) {
    const color = mark.attrs.color;
    if (!isBlockNoteColor(color)) return ["mark", {}, 0];
    return [
      "mark",
      mergeAttributes({
        class: `hl-${color}`,
        style: `background-color:${BLOCKNOTE_COLORS[color].background}`,
      }),
      0,
    ];
  },

  renderMarkdown(node, helpers) {
    const content = helpers.renderChildren(node);
    const color = node.attrs?.color;
    if (!isBlockNoteColor(color)) return `<mark>${content}</mark>`;
    const tag = highlightTag(color);
    return `${tag.open}${content}${tag.close}`;
  },
});

// The mention node. Reuses @tiptap/extension-mention (id/label attrs + the
// "@" suggestion machinery) and binds the markdown contract on top:
//  - out: renderMarkdown → [@Title](ledgr://item/<uuid>)
//  - in:  a custom inline tokenizer reclaims that exact link as a mention
//         token before the Link mark can claim it, so the round-trip holds.
// The suggestion items are supplied where the editor is created.
export const LedgrMention = Mention.extend({
  // A non-serialized `type` attr (the target's type key) on top of Mention's
  // id/label. The suggestion sets it on insert so the chip is glyphed instantly;
  // it never reaches the markdown (renderMarkdown below emits only id + label),
  // so the canonical body contract is untouched.
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      type: { default: null, rendered: false },
    };
  },

  // Per-editor store the mention chips (the NodeView) read for live type/icon/
  // status. MarkdownEditor fills `resolved` via a batch resolve and calls every
  // `rerender` callback; `ready` gates the "missing" state until the first load.
  addStorage() {
    return {
      ...(this.parent?.() ?? {}),
      resolved: new Map(),
      rerender: new Set<() => void>(),
      ready: false,
    };
  },

  // The chip is a NodeView (mention-node-view.ts): live glyph, click-to-open,
  // and an interactive task checkbox — none of which a static renderHTML can do.
  addNodeView() {
    return (props) => createMentionNodeView(props);
  },

  // Static fallback for getHTML()/clipboard (the NodeView owns the live editor
  // DOM). Carries the id + the type class so a copied chip keeps its hook.
  renderHTML({ node }) {
    const type = typeof node.attrs.type === "string" ? node.attrs.type : null;
    return [
      "span",
      mergeAttributes({
        class: "ledgr-mention" + (type ? ` mention--${type}` : ""),
        "data-item-id": node.attrs.id ?? "",
        ...(type ? { "data-item-type": type } : {}),
      }),
      `@${node.attrs.label || "untitled"}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label || "untitled"}`;
  },

  renderMarkdown(node) {
    const id = typeof node.attrs?.id === "string" ? node.attrs.id : "";
    const label =
      typeof node.attrs?.label === "string" && node.attrs.label
        ? node.attrs.label
        : "untitled";
    return mentionToMarkdown(id, label);
  },

  // Reclaim [@Title](ledgr://item/<id>) at the inline level. start() points
  // marked at the next candidate so the tokenizer isn't asked to run on every
  // character; tokenize() only matches our exact mention-link shape.
  markdownTokenizer: {
    name: "mention",
    level: "inline",
    start: (src: string) => {
      const i = src.indexOf("[@");
      return i < 0 ? src.length : i;
    },
    tokenize: (src: string) => {
      const m = /^\[@((?:\\.|[^\]\\])+)\]\(ledgr:\/\/item\/([^)\s]+)\)/.exec(
        src
      );
      if (!m) return undefined;
      const label = m[1].replace(/\\([\\[\]])/g, "$1");
      return {
        type: "mention",
        raw: m[0],
        // carried through to parseMarkdown below
        mentionLabel: label,
        mentionId: m[2],
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("mention", {
      id: token.mentionId,
      label: token.mentionLabel,
    });
  },
});

// The passage node (ADR-149). A static inline atom — the passage sibling of
// LedgrMention, but with NO NodeView: a passage is fixed reference data (no live
// status, no checkbox), so a static chip is right. The markdown contract mirrors
// the mention exactly:
//  - out: renderMarkdown → [Label](ledgr://passage/<start>[-<end>])
//  - in:  a custom inline tokenizer reclaims that exact link BEFORE the Link mark
//         can claim it, so the round-trip holds (same as the mention tokenizer).
// The href points at the virtual passage page (/passage/<slug>); the ledgr://
// URI lives only in the markdown so syncPassageRefs can find the edge.
export const LedgrPassage = Node.create({
  name: "passage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      startRef: { default: null },
      endRef: { default: null },
      // The human display label ("Romans 8:5–9"); regenerated from the refs when
      // absent so a hand-authored link with no label still chips correctly.
      label: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-passage-start]",
        getAttrs: (el) => {
          const node = el as HTMLElement;
          const start = Number(node.getAttribute("data-passage-start"));
          if (!Number.isSafeInteger(start)) return false;
          const endAttr = node.getAttribute("data-passage-end");
          const end = endAttr != null && endAttr !== "" ? Number(endAttr) : start;
          return { startRef: start, endRef: end, label: node.textContent || null };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const { start, end, label } = passageAttrs(node);
    return [
      "a",
      mergeAttributes({
        class: "ledgr-passage",
        href: `/passage/${passageSlug(start, end)}`,
        "data-passage-start": String(start),
        "data-passage-end": String(end),
      }),
      label,
    ];
  },

  renderText({ node }) {
    return passageAttrs(node).label;
  },

  renderMarkdown(node) {
    // Cast like LedgrImage/LedgrMention: @tiptap/markdown's augmented hook types
    // the node loosely, but it always carries attrs at runtime.
    const { start, end, label } = passageAttrs(node as { attrs?: Record<string, unknown> });
    return passageToMarkdown(start, end, label);
  },

  // Reclaim [Label](ledgr://passage/<slug>) at the inline level, before Link.
  // Passage labels carry no "@" sentinel, so start() locates the href marker and
  // backs up to the opening "[" (labels are canon refs, never contain "]").
  markdownTokenizer: {
    name: "passage",
    level: "inline",
    start: (src: string) => {
      const i = src.indexOf("](ledgr://passage/");
      if (i < 0) return src.length;
      const open = src.lastIndexOf("[", i);
      return open < 0 ? src.length : open;
    },
    tokenize: (src: string) => {
      const m = /^\[((?:\\.|[^\]\\])*)\]\(ledgr:\/\/passage\/(\d+(?:-\d+)?)\)/.exec(src);
      if (!m) return undefined;
      const ref = parsePassageSlug(m[2]);
      if (!ref) return undefined;
      const label = m[1].replace(/\\([\\[\]])/g, "$1");
      return {
        type: "passage",
        raw: m[0],
        passageStart: ref.startRef,
        passageEnd: ref.endRef,
        passageLabel: label,
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("passage", {
      startRef: token.passageStart,
      endRef: token.passageEnd,
      label: token.passageLabel,
    });
  },
});

// Coerce a passage node's attrs to numbers + a display label, deriving the label
// from the refs when it's missing. Shared by every render hook above.
function passageAttrs(node: { attrs?: Record<string, unknown> }): {
  start: number;
  end: number;
  label: string;
} {
  const a = node.attrs ?? {};
  const start = Number(a.startRef);
  const end = a.endRef != null ? Number(a.endRef) : start;
  const label =
    typeof a.label === "string" && a.label ? a.label : formatPassageRef(start, end);
  return { start, end, label };
}

// Inline image node. inline:true is required, not cosmetic: marked emits a
// `![]()` as an inline token inside a paragraph, and @tiptap/markdown dispatches
// that token to this node's parseMarkdown — a block image would violate the
// paragraph's content schema. The markdown shape (![alt](src)) lives in the
// pure helper; the bytes are uploaded to R2 by the editor's paste/drop handler.
// Params are untyped so @tiptap/markdown's augmented hook signatures infer
// them (the color/mention extensions above do the same); we cast to the precise
// shapes inside, where the structure is known.
export const LedgrImage = Image.extend({
  inline: true,
  group: "inline",

  renderMarkdown(node) {
    const a = (node as { attrs?: Record<string, unknown> }).attrs ?? {};
    return imageToMarkdown({
      src: typeof a.src === "string" ? a.src : "",
      alt: typeof a.alt === "string" ? a.alt : "",
      title: typeof a.title === "string" ? a.title : null,
    });
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("image", imageAttrsFromToken(token as ImageToken));
  },
});

// The table node carries the whole-table markdown contract; the row/header/cell
// nodes are registered as-is (re-exported below) and walked by these hooks.
// On serialize the node arrives as Tiptap JSON (content is a JSONContent[]); on
// parse, marked hands one table block token (header[] + rows[][], each cell
// holding inline tokens), so parseMarkdown rebuilds the subtree and
// renderMarkdown flattens it to GFM via the pure assembler. The server renderer
// (markdown-it) already renders GFM tables, so print/share/export are covered.
type MarkedTableCell = { tokens?: unknown[]; text?: string };
type MarkedTableToken = { header: MarkedTableCell[]; rows: MarkedTableCell[][] };
type JsonNode = { content?: JsonNode[] };

export const LedgrTable = Table.extend({
  renderMarkdown(node, helpers) {
    const rows: string[][] = [];
    for (const rowNode of (node as JsonNode).content ?? []) {
      const cells: string[] = [];
      for (const cellNode of rowNode.content ?? []) {
        cells.push(helpers.renderChildren(cellNode));
      }
      rows.push(cells);
    }
    return tableToGfm(rows);
  },

  parseMarkdown(token, helpers) {
    const t = token as unknown as MarkedTableToken;
    const cellContent = (cell: MarkedTableCell): JSONContent[] => {
      if (cell.tokens && cell.tokens.length) {
        return helpers.parseInline(
          cell.tokens as Parameters<typeof helpers.parseInline>[0]
        ) as JSONContent[];
      }
      if (cell.text) return [helpers.createTextNode(cell.text) as JSONContent];
      return [];
    };
    const makeCell = (cell: MarkedTableCell, header: boolean) =>
      helpers.createNode(header ? "tableHeader" : "tableCell", null, [
        helpers.createNode("paragraph", null, cellContent(cell)),
      ]);
    const headerRow = helpers.createNode(
      "tableRow",
      null,
      t.header.map((c) => makeCell(c, true))
    );
    const bodyRows = t.rows.map((r) =>
      helpers.createNode(
        "tableRow",
        null,
        r.map((c) => makeCell(c, false))
      )
    );
    return helpers.createNode("table", null, [headerRow, ...bodyRows]);
  },
});

export { TableRow, TableHeader, TableCell };

// The "ledgr://item/" prefix is the load-bearing piece of the round-trip;
// re-exported so the editor and any consumer reference one constant.
export const MENTION_PREFIX = MENTION_URI_PREFIX;
