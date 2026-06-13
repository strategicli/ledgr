// The only way a page may pull in the Tiptap editor: a client-side dynamic
// import, so lists and other surfaces never pay the editor bundle (CLAUDE.md
// rule 8 / PRD §6.4). Mirrors LazyEditor for the BlockNote path.
"use client";

import dynamic from "next/dynamic";
import type { MarkdownEditorProps } from "./MarkdownEditor";

const LazyMarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="px-4 py-3 text-sm text-neutral-400">Loading editor…</div>
    ),
  }
);

export default LazyMarkdownEditor;
