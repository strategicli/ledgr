// The Ledgr BlockNote schema: the default blocks (headings, lists,
// checkboxes, quote, divider, code, image — everything PRD §4.1 asks for
// ships in BlockNote's defaults) plus the @-mention inline node. The
// mention's props (itemId, title) are what the server-side mention sync
// (src/lib/mentions.ts) and markdown serializer (src/lib/markdown.ts) read,
// so their names are load-bearing.
"use client";

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { createReactInlineContentSpec } from "@blocknote/react";

export const Mention = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      itemId: { default: "" },
      title: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => (
      <span
        className="ledgr-mention"
        data-item-id={props.inlineContent.props.itemId}
      >
        @{props.inlineContent.props.title || "untitled"}
      </span>
    ),
  }
);

export const schema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: Mention,
  },
  styleSpecs: defaultStyleSpecs,
});

export type LedgrEditor = typeof schema.BlockNoteEditor;
export type LedgrBlock = typeof schema.Block;
