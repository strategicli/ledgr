// The Tiptap markdown editor (M2, ADR-038). Never imported directly from a
// page — only through LazyMarkdownEditor (code-split, client-only), the same
// discipline the BlockNote editor follows (CLAUDE.md rule 8). It reads and
// writes markdown text: content goes in as { contentType: "markdown" } and
// every edit emits editor.getMarkdown(), because markdown is the source of
// truth (ADR-037). Colors and mentions round-trip through the bespoke
// extensions; the rest is StarterKit + the first-party Markdown extension.
"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef } from "react";
import {
  BLOCKNOTE_COLORS,
  type BlockNoteColor,
} from "@/lib/colors";
import {
  Highlight,
  LedgrImage,
  LedgrMention,
  LedgrTable,
  TableCell,
  TableHeader,
  TableRow,
  TextColor,
} from "./extensions";
import { createMentionSuggestion } from "./mention-suggestion";
import "./markdown-editor.css";

export type MarkdownEditorProps = {
  // The host item, so the @-menu can exclude it from its own results.
  itemId?: string;
  initialMarkdown: string;
  // Fired with the full markdown string on every edit; the host debounces.
  onChange: (markdown: string) => void;
  // Optional: hands the live editor up once ready, so a host can drive
  // imperative inserts (e.g. the Changelog notes "Sign" stamp). No-op when unset.
  onEditorReady?: (editor: Editor) => void;
  // Optional: upload an image file (paste/drop/button) and resolve its public
  // URL. When unset, image insertion is disabled — controlled hosts with no
  // backing item (scratch route, Changelog notes) pass nothing.
  uploadImage?: (file: File) => Promise<string>;
};

const COLOR_NAMES = Object.keys(BLOCKNOTE_COLORS) as BlockNoteColor[];

// Pull image files out of a paste/drop payload (ignore non-images so text and
// markdown paste fall through to Tiptap's normal handling).
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}

// Upload each image and drop it in at the current selection. Sequential so
// multiple pasted images keep their order; the selection advances past each
// inserted node, so the next one lands after it.
async function insertUploadedImages(
  view: EditorView,
  files: File[],
  upload: (file: File) => Promise<string>
) {
  for (const file of files) {
    try {
      const url = await upload(file);
      const imageType = view.state.schema.nodes.image;
      if (!imageType) continue;
      const alt = (file.name || "").replace(/\.[^.]+$/, "");
      const node = imageType.create({ src: url, alt });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    } catch (err) {
      console.error("image upload failed", err);
    }
  }
}

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
  onEditorReady,
  uploadImage,
}: MarkdownEditorProps) {
  // onChange and uploadImage are kept in refs so the editor's once-bound
  // callbacks (onUpdate, the paste/drop handlers) always see the latest props
  // without re-creating the editor. Synced in an effect, not during render.
  const onChangeRef = useRef(onChange);
  const uploadRef = useRef(uploadImage);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
    uploadRef.current = uploadImage;
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Markdown,
      // GFM task lists (- [ ] / - [x]): @tiptap/markdown round-trips them, so no
      // bespoke serializer is needed (unlike the color marks). nested lets a
      // checklist item hold a sub-checklist.
      TaskList,
      TaskItem.configure({ nested: true }),
      TextColor,
      Highlight,
      // Inline images (paste/drop → R2) and GFM tables. Both round-trip to
      // markdown via the hooks in extensions.ts.
      LedgrImage,
      LedgrTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      LedgrMention.configure({
        HTMLAttributes: { class: "ledgr-mention" },
        suggestion: createMentionSuggestion(itemId),
      }),
    ],
    content: initialMarkdown,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "ProseMirror ledgr-prose" },
      // Paste/drop of image files → upload to R2, insert as a markdown image.
      // Only intercepts when an image is actually present and an uploader is
      // wired; everything else falls through to normal (markdown) paste.
      handlePaste: (view, event) => {
        const upload = uploadRef.current;
        if (!upload) return false;
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertUploadedImages(view, files, upload);
        return true;
      },
      handleDrop: (view, event) => {
        const upload = uploadRef.current;
        if (!upload) return false;
        const files = imageFilesFrom(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (coords) {
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, coords.pos)
            )
          );
        }
        void insertUploadedImages(view, files, upload);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getMarkdown()),
  });

  // Keep the toolbar's active states in sync with the cursor. useEditor alone
  // doesn't re-render React on a bare selection change (clicking into an H1
  // without typing), so reading editor.isActive() during render went stale
  // until the next keystroke — the "toolbar sometimes doesn't update / is
  // slow" symptom. useEditorState subscribes to the selection and re-renders
  // only when one of these derived values actually changes.
  const toolbar = useEditorState({
    editor,
    selector: ({ editor }) => ({
      isBold: editor?.isActive("bold") ?? false,
      isItalic: editor?.isActive("italic") ?? false,
      isStrike: editor?.isActive("strike") ?? false,
      isH1: editor?.isActive("heading", { level: 1 }) ?? false,
      isH2: editor?.isActive("heading", { level: 2 }) ?? false,
      isBulletList: editor?.isActive("bulletList") ?? false,
      isOrderedList: editor?.isActive("orderedList") ?? false,
      isTaskList: editor?.isActive("taskList") ?? false,
      isBlockquote: editor?.isActive("blockquote") ?? false,
      isCodeBlock: editor?.isActive("codeBlock") ?? false,
      textColor: (editor?.getAttributes("textColor").color as string) || "",
      highlight: (editor?.getAttributes("highlight").color as string) || "",
    }),
  });

  // Safety net for the @-mention popup. It lives on document.body (outside
  // React), so if the editor unmounts mid-suggestion — e.g. navigating away
  // with the menu still open — Tiptap may not fire the suggestion's onExit and
  // the popup would strand on the page until a full refresh. Sweep any lingering
  // popup on unmount. (The suggestion also self-closes on click-away; this
  // covers the route-change path.)
  useEffect(() => {
    return () => {
      document
        .querySelectorAll(".ledgr-mention-popup")
        .forEach((n) => n.remove());
    };
  }, []);

  // Hand the editor up once it exists, for hosts that drive imperative inserts.
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

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
  }, [initialMarkdown, editor]);

  if (!editor || !toolbar) {
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
          active={toolbar.isBold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="I"
          title="Italic"
          active={toolbar.isItalic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="S"
          title="Strikethrough"
          active={toolbar.isStrike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          label="H1"
          title="Heading 1"
          active={toolbar.isH1}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <ToolbarButton
          label="H2"
          title="Heading 2"
          active={toolbar.isH2}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolbarButton
          label="• List"
          title="Bullet list"
          active={toolbar.isBulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="1. List"
          title="Numbered list"
          active={toolbar.isOrderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="☑ Tasks"
          title="Checklist (- [ ])"
          active={toolbar.isTaskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        />
        <ToolbarButton
          label="❝"
          title="Quote"
          active={toolbar.isBlockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="</>"
          title="Code block"
          active={toolbar.isCodeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarButton
          label="▦ Table"
          title="Insert table"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        />
        {uploadImage ? (
          <ToolbarButton
            label="🖼 Image"
            title="Insert image (or paste/drop one)"
            onClick={() => fileInputRef.current?.click()}
          />
        ) : null}

        <span className="mx-1 h-5 w-px bg-neutral-700" />

        {/* Text color */}
        <select
          title="Text color"
          className="rounded bg-neutral-800 px-1 py-1 text-sm text-neutral-200"
          value={toolbar.textColor}
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
          value={toolbar.highlight}
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

      {/* Hidden picker behind the toolbar's Image button (same R2 upload path
          as paste/drop). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const upload = uploadRef.current;
          const files = Array.from(e.target.files ?? []).filter((f) =>
            f.type.startsWith("image/")
          );
          e.target.value = ""; // allow re-picking the same file
          if (upload && files.length) {
            editor.chain().focus().run();
            void insertUploadedImages(editor.view, files, upload);
          }
        }}
      />
    </div>
  );
}
