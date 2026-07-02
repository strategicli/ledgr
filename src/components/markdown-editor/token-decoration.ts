// LT2: highlight live {{item.*}} / {{parent.*}} tokens in the rich editor.
//
// Tokens are PLAIN TEXT in the canonical body (ADR-139) — nothing about the
// markdown contract changes. This is a display-only ProseMirror decoration: it
// walks the doc's text nodes, finds recognized token ranges (the pure
// findItemTokenRanges), and wraps each in a styled <span class="ledgr-token">
// with a title tooltip naming the field. No node, no schema change, no
// round-trip risk — remove the extension and the text is untouched. The
// resolved VALUE shows in Preview (LT1); the rich editor shows the token so the
// author sees what's live.
"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findItemTokenRanges } from "@/lib/item-tokens";

const tokenDecoKey = new PluginKey("ledgrItemTokenDecoration");

function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const r of findItemTokenRanges(node.text)) {
      decos.push(
        Decoration.inline(pos + r.start, pos + r.end, {
          class: "ledgr-token",
          title: `Live value: ${r.expr}`,
        })
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

export const ItemTokenDecoration = Extension.create({
  name: "itemTokenDecoration",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tokenDecoKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          // Recompute only when the document actually changed (cheap: the doc
          // walk is O(text nodes), and typing outside a token leaves the set
          // effectively identical anyway).
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
