// Source mode (ADR-125): the body's raw markdown in a plain <textarea>, the
// deliberate opposite of the rich Tiptap canvas. A native textarea holds
// megabytes of text without lag because it is NOT contenteditable and has no
// node tree, which is exactly why it is the only editor that survives the
// million-character notes that freeze ProseMirror. No syntax highlighting (that
// would re-introduce the per-keystroke DOM cost we are escaping) — `###` shows
// as `###`. Uncontrolled (defaultValue + onChange): the string already exists on
// the event, so reading it is free, and React never re-sets the giant value.
"use client";

import { useRef } from "react";

export default function RawMarkdownEditor({
  initialMarkdown,
  onChange,
  editable = true,
}: {
  initialMarkdown: string;
  // Fired with the full markdown on every edit; the host debounces (ItemEditor).
  onChange: (markdown: string) => void;
  // When false (a locked item): read-only, cursor can't enter.
  editable?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <textarea
      ref={ref}
      defaultValue={initialMarkdown}
      readOnly={!editable}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Markdown source…"
      className="ledgr-source min-h-[60vh] w-full resize-y bg-transparent font-mono text-sm leading-relaxed text-neutral-200 outline-none placeholder:text-neutral-600"
    />
  );
}
