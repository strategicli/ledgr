// The Tiptap markdown editor (M2, ADR-038). Never imported directly from a
// page — only through LazyMarkdownEditor (code-split, client-only), the same
// discipline the BlockNote editor follows (CLAUDE.md rule 8). It reads and
// writes markdown text: content goes in as { contentType: "markdown" } and
// every edit emits editor.getMarkdown(), because markdown is the source of
// truth (ADR-037). Colors and mentions round-trip through the bespoke
// extensions; the rest is StarterKit + the first-party Markdown extension.
"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { useEffect, useRef } from "react";
import {
  BLOCKNOTE_COLORS,
  type BlockNoteColor,
} from "@/lib/colors";
import { Highlight, LedgrMention, TextColor } from "./extensions";
import { createMentionSuggestion } from "./mention-suggestion";
import "./markdown-editor.css";

export type MarkdownEditorProps = {
  // The host item, so the @-menu can exclude it from its own results.
  itemId?: string;
  initialMarkdown: string;
  // Fired with the full markdown string on every edit; the host debounces.
  onChange: (markdown: string) => void;
};

const COLOR_NAMES = Object.keys(BLOCKNOTE_COLORS) as BlockNoteColor[];

function ToolbarButton({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded px-2 py-1 text-sm ${
        active
          ? "bg-neutral-700 text-neutral-100"
          : "text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}

export default function MarkdownEditor({
  itemId,
  initialMarkdown,
  onChange,
}: MarkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Markdown,
      TextColor,
      Highlight,
      LedgrMention.configure({
        HTMLAttributes: { class: "ledgr-mention" },
        suggestion: createMentionSuggestion(itemId),
      }),
    ],
    content: initialMarkdown,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "ProseMirror ledgr-prose" },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getMarkdown()),
  });

  // If the host swaps in a different document (e.g. "reload from saved" on the
  // scratch route), reset the editor to it without firing onUpdate.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getMarkdown();
    if (current !== initialMarkdown) {
      editor.commands.setContent(initialMarkdown, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarkdown, editor]);

  if (!editor) {
    return (
      <div className="px-4 py-3 text-sm text-neutral-400">Loading editor…</div>
    );
  }

  const setColor = (color: BlockNoteColor | null) => {
    const chain = editor.chain().focus();
    if (color) chain.setMark("textColor", { color }).run();
    else chain.unsetMark("textColor").run();
  };

  const setHighlight = (color: BlockNoteColor | null) => {
    const chain = editor.chain().focus();
    if (color) chain.setMark("highlight", { color }).run();
    else chain.unsetMark("highlight").run();
  };

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950">
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-800 p-2">
        <ToolbarButton
          label="B"
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="I"
          title="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="H1"
          title="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <ToolbarButton
          label="H2"
          title="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolbarButton
          label="• List"
          title="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="1. List"
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="❝"
          title="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="</>"
          title="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />

        <span className="mx-1 h-5 w-px bg-neutral-700" />

        {/* Text color */}
        <select
          title="Text color"
          className="rounded bg-neutral-800 px-1 py-1 text-sm text-neutral-200"
          value={(editor.getAttributes("textColor").color as string) || ""}
          onChange={(e) =>
            setColor((e.target.value || null) as BlockNoteColor | null)
          }
        >
          <option value="">Color…</option>
          {COLOR_NAMES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* Highlight */}
        <select
          title="Highlight"
          className="rounded bg-neutral-800 px-1 py-1 text-sm text-neutral-200"
          value={(editor.getAttributes("highlight").color as string) || ""}
          onChange={(e) =>
            setHighlight((e.target.value || null) as BlockNoteColor | null)
          }
        >
          <option value="">Highlight…</option>
          {COLOR_NAMES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <span className="ml-2 text-xs text-neutral-500">
          Type <kbd className="rounded bg-neutral-800 px-1">@</kbd> to mention
        </span>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
