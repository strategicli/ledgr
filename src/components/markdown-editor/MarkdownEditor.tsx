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
import { Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TOOLBAR_ICONS } from "./toolbar-icons";
import { useRouter } from "next/navigation";
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
import {
  BlockAnchor,
  PROMOTE_LINE_EVENT,
  OPEN_ITEM_EVENT,
  ensureAnchorAtPos,
  ensureAnchorAtSelection,
  scrollToBlockId,
  setPromotedRefs,
  type PromotedRefs,
} from "./block-anchor-extension";
import { extractPromotable } from "@/lib/editor/block-anchor";
import PromoteLinePopup, { type PromoteDraft } from "./PromoteLinePopup";
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
  // When set (meetings, ADR-090): enable the per-line "→ task" promote
  // affordance, posting to this meeting's promote endpoint.
  promoteToMeetingId?: string;
  // Flush the host's debounced body save and resolve when done — called before a
  // promote POST so the line's freshly-inserted ^id anchor is persisted first.
  onRequestSave?: () => Promise<void>;
  // blockRef → the task it was promoted to (ADR-090): shows a "✓ task" badge on
  // those lines instead of the promote button, and links to the task.
  promotedRefs?: PromotedRefs;
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
  icon,
  active,
  onClick,
  title,
}: {
  label?: string;
  icon?: ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-sm font-medium ${
        active
          ? "bg-neutral-700 text-neutral-100"
          : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      {icon ?? label}
    </button>
  );
}

export default function MarkdownEditor({
  itemId,
  initialMarkdown,
  onChange,
  onEditorReady,
  uploadImage,
  promoteToMeetingId,
  onRequestSave,
  promotedRefs,
}: MarkdownEditorProps) {
  // onChange and uploadImage are kept in refs so the editor's once-bound
  // callbacks (onUpdate, the paste/drop handlers) always see the latest props
  // without re-creating the editor. Synced in an effect, not during render.
  const onChangeRef = useRef(onChange);
  const uploadRef = useRef(uploadImage);
  const onRequestSaveRef = useRef(onRequestSave);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // The promote popup's draft, or null when closed (ADR-090).
  const [promote, setPromote] = useState<{
    blockId: string;
    title: string;
    body: string;
  } | null>(null);
  // Brief "Copied" feedback on the copy-link-to-line button.
  const [linkCopied, setLinkCopied] = useState(false);
  useEffect(() => {
    onChangeRef.current = onChange;
    uploadRef.current = uploadImage;
    onRequestSaveRef.current = onRequestSave;
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Markdown,
      // Empty-state hint: a quiet "Start writing…" while the body is empty, the
      // first impression of every new note. First-party (@tiptap/extensions),
      // styled via the is-editor-empty class in markdown-editor.css. No "/" hint
      // since there's no slash menu yet (ADR-037 defers the Notion feel).
      Placeholder.configure({ placeholder: "Start writing…" }),
      // GFM task lists (- [ ] / - [x]): @tiptap/markdown round-trips them, so no
      // bespoke serializer is needed (unlike the color marks). nested lets a
      // checklist item hold a sub-checklist.
      TaskList,
      TaskItem.configure({ nested: true }),
      // Block anchors (ADR-090): dim trailing ^id markers + the jump-to/ensure
      // primitives the action-item → task promotion rides on. The per-line
      // "→ task" widget shows only when a meeting wired the promote path; a
      // promoted line shows a "✓ task" badge instead (the ref map is pushed into
      // plugin state by an effect, so the badge updates after a promotion).
      BlockAnchor.configure({ promote: !!promoteToMeetingId }),
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

  // Promote affordance (ADR-090): a checkbox line's "→ task" button fires a DOM
  // event carrying its position. Ensure the line has an ^id anchor, then open
  // the popup pre-filled with the line's text + sub-bullets (deterministic).
  useEffect(() => {
    if (!editor || !promoteToMeetingId) return;
    const dom = editor.view.dom;
    const handler = (e: Event) => {
      const pos = (e as CustomEvent<{ pos: number }>).detail?.pos;
      if (typeof pos !== "number") return;
      const id = ensureAnchorAtPos(editor, pos);
      if (!id) return;
      // The insert changed the doc; push it into the host's pending save so the
      // pre-promote flush (onRequestSave) persists the anchor.
      onChangeRef.current(editor.getMarkdown());
      const ex = extractPromotable(editor.getMarkdown(), id) ?? { title: "", body: "" };
      setPromote({ blockId: id, title: ex.title, body: ex.body });
    };
    dom.addEventListener(PROMOTE_LINE_EVENT, handler);
    return () => dom.removeEventListener(PROMOTE_LINE_EVENT, handler);
  }, [editor, promoteToMeetingId]);

  // A "✓ task" badge (or any deep link to a line) fires ledgr-open-item; navigate
  // there with the SPA router rather than a full reload.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: Event) => {
      const itemId = (e as CustomEvent<{ itemId: string }>).detail?.itemId;
      if (itemId) router.push(`/items/${itemId}`);
    };
    dom.addEventListener(OPEN_ITEM_EVENT, handler);
    return () => dom.removeEventListener(OPEN_ITEM_EVENT, handler);
  }, [editor, router]);

  // Deep link to a line (ADR-090): a #^id hash scrolls the editor to that line
  // and flashes it — on first mount (arriving from a copied link / a task's
  // source backlink) and on in-page hashchange. A short delay lets layout settle.
  useEffect(() => {
    if (!editor) return;
    const jump = () => {
      const m = /^#\^([a-z0-9]+)$/.exec(window.location.hash);
      if (m) window.setTimeout(() => scrollToBlockId(editor, m[1]), 80);
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, [editor]);

  // Push the promoted-ref map into the plugin whenever it changes (e.g. after a
  // promotion refreshes the page) so the "✓ task" badge updates.
  useEffect(() => {
    if (editor) setPromotedRefs(editor, promotedRefs ?? {});
  }, [editor, promotedRefs]);

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

  // Create the task from the popup draft (ADR-090): flush the body save so the
  // anchor is persisted, POST the promotion, then refresh so the new task shows
  // in the prep panel and the promoted line gets its badge.
  const submitPromote = async (draft: PromoteDraft) => {
    const meetingId = promoteToMeetingId;
    const blockRef = promote?.blockId;
    if (!meetingId) return;
    setPromote(null);
    try {
      await onRequestSaveRef.current?.();
      await fetch(`/api/items/${meetingId}/promote-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title, body: draft.body, blockRef }),
      });
      router.refresh();
    } catch (err) {
      console.error("promote failed", err);
    }
  };

  // Copy a deep link to the cursor's line (ADR-090): ensure that line has an ^id
  // anchor, then copy an absolute /items/<id>#^<id> URL. Works on any line/type.
  const copyLineLink = async () => {
    if (!itemId) return;
    const id = ensureAnchorAtSelection(editor);
    if (!id) return;
    // The insert (if any) changed the doc; feed the host's debounced save so the
    // anchor persists and the link resolves after navigation.
    onChangeRef.current(editor.getMarkdown());
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/items/${itemId}#^${id}`
      );
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      console.error("clipboard write failed");
    }
  };

  return (
    <div className="border-b border-neutral-800">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-800/70 px-1 py-1.5">
        <ToolbarButton
          icon={TOOLBAR_ICONS.bold}
          title="Bold"
          active={toolbar.isBold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={TOOLBAR_ICONS.italic}
          title="Italic"
          active={toolbar.isItalic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={TOOLBAR_ICONS.strike}
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
          icon={TOOLBAR_ICONS.bulletList}
          title="Bullet list"
          active={toolbar.isBulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={TOOLBAR_ICONS.orderedList}
          title="Numbered list"
          active={toolbar.isOrderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={TOOLBAR_ICONS.tasks}
          title="Checklist (- [ ])"
          active={toolbar.isTaskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        />
        <ToolbarButton
          icon={TOOLBAR_ICONS.quote}
          title="Quote"
          active={toolbar.isBlockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          icon={TOOLBAR_ICONS.code}
          title="Code block"
          active={toolbar.isCodeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarButton
          icon={TOOLBAR_ICONS.table}
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
            icon={TOOLBAR_ICONS.image}
            title="Insert image (or paste/drop one)"
            onClick={() => fileInputRef.current?.click()}
          />
        ) : null}
        {itemId ? (
          <ToolbarButton
            icon={TOOLBAR_ICONS.link}
            title="Copy a link to this line (from the cursor)"
            active={linkCopied}
            onClick={() => void copyLineLink()}
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

      {promote && (
        <PromoteLinePopup
          initialTitle={promote.title}
          initialBody={promote.body}
          onSubmit={submitPromote}
          onCancel={() => setPromote(null)}
        />
      )}
    </div>
  );
}
