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
import { useKeyboardInset } from "./useKeyboardInset";
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
import { mentionStorage, type MentionStorage } from "./mention-node-view";
import { collectMentionIdsFromMarkdown } from "@/lib/editor/mention-markdown";
import type { ResolvedMention } from "@/lib/mentions";
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
  // When true, the formatting toolbar starts HIDDEN behind a small top-right
  // toggle button (the task canvas default — a task body is mostly plain text, so
  // the bar is opt-in noise). Default false keeps the bar always-on (notes etc.).
  collapsibleToolbar?: boolean;
  // When true, the editor has no tall min-height: it starts one line tall and
  // grows with content (the task canvas, where bodies are short). Default false
  // keeps the roomy 14rem writing area.
  compact?: boolean;
  // When false (a locked item, item lock toggle): the body is read-only.
  // Tiptap drops contenteditable so the cursor can't enter, and the toolbar is
  // hidden — the document still renders, it just can't be changed. Defaults true.
  editable?: boolean;
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

// Configurable toolbar (app-wide): the ids a user hid live in
// settings.editorToolbarHidden. Fetched once per page load (memoized) so every
// editor instance shares the single request.
let hiddenToolbarPromise: Promise<string[]> | null = null;
function loadHiddenToolbar(): Promise<string[]> {
  hiddenToolbarPromise ??= fetch("/api/settings")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) =>
      Array.isArray(d?.settings?.editorToolbarHidden)
        ? (d.settings.editorToolbarHidden as string[])
        : []
    )
    .catch(() => []);
  return hiddenToolbarPromise;
}

function ToolbarButton({
  label,
  icon,
  active,
  disabled,
  onClick,
  title,
}: {
  label?: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-sm font-medium ${
        disabled
          ? "cursor-default text-neutral-600"
          : active
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
  collapsibleToolbar = false,
  compact = false,
  editable = true,
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
  // The hyperlink editor's draft URL, or null when the editor is closed. Opened
  // by the toolbar's Insert-link button; applies the StarterKit Link mark.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
    uploadRef.current = uploadImage;
    onRequestSaveRef.current = onRequestSave;
  });

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit,
      // Serialize nested lists at a 4-space step. @tiptap/markdown defaults to
      // 2 spaces, which the editor's own (lenient) parser nests fine but
      // CommonMark renderers (markdown-it, on the print/share/export path, and
      // any external tool reading the exported .md) read as too shallow under an
      // ordered "1. " marker (needs >=3), flattening the list. 4 keeps the
      // canonical markdown nestable everywhere. The render path also normalizes
      // legacy 2-space content (markdown-render.ts), so this is the source-side
      // half of keeping the editor and every render in agreement.
      Markdown.configure({ indentation: { style: "space", size: 4 } }),
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
      attributes: { class: compact ? "ProseMirror ledgr-prose ledgr-prose-compact" : "ProseMirror ledgr-prose" },
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
      isLink: editor?.isActive("link") ?? false,
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

  // Lock/unlock at runtime (the item lock toggle): a locked item drops
  // contenteditable so the cursor can't enter, and the toolbar hides below.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

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

  // Type-aware mention chips: resolve the type/icon/status for every mention in
  // the doc (a body-free batch GET /api/items?ids=) into the mention extension's
  // store, then repaint the chips. Runs once when the editor is ready and again,
  // debounced, after edits (so a freshly inserted or re-typed mention resolves).
  // Markdown stays the source of truth — nothing here is written back to it.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const resolve = async () => {
      const store = mentionStorage(editor) as MentionStorage | undefined;
      if (!store) return;
      const ids = collectMentionIdsFromMarkdown(editor.getMarkdown());
      if (ids.length === 0) {
        store.resolved = new Map();
        store.ready = true;
        store.rerender.forEach((fn) => fn());
        return;
      }
      try {
        const res = await fetch(
          `/api/items?ids=${ids.map(encodeURIComponent).join(",")}`
        );
        if (!res.ok || cancelled) return;
        const { items } = (await res.json()) as { items: ResolvedMention[] };
        store.resolved = new Map(items.map((it) => [it.id, it]));
        store.ready = true;
        store.rerender.forEach((fn) => fn());
      } catch {
        // Leave chips on their last-known glyph; a later edit retries.
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void resolve(), 350);
    };
    void resolve();
    editor.on("update", schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      editor.off("update", schedule);
    };
  }, [editor]);

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

  const [hiddenTb, setHiddenTb] = useState<Set<string>>(new Set());
  useEffect(() => {
    loadHiddenToolbar().then((ids) => setHiddenTb(new Set(ids)));
  }, []);
  const showTb = (id: string) => !hiddenTb.has(id);
  // The formatting bar is hidden by default when collapsible (task canvas); a
  // top-right toggle reveals it. When not collapsible it's always shown.
  const [toolbarOpen, setToolbarOpen] = useState(!collapsibleToolbar);

  // Mobile editing posture (≥640px / `sm` is desktop and unaffected). On a phone
  // the toolbar becomes a single-row bar that floats on top of the on-screen
  // keyboard while the editor is focused; `keyboardInset` is how far up from the
  // bottom edge to sit. While focused we also set body[data-editing] so the Work
  // nav pill (which lives at the same bottom-of-screen spot) hides — globals.css
  // owns that one rule, so the two bottom bars never overlap.
  const [focused, setFocused] = useState(false);
  const keyboardInset = useKeyboardInset();
  useEffect(() => {
    if (!editor) return;
    const onFocus = () => {
      setFocused(true);
      document.body.dataset.editing = "true";
    };
    const onBlur = () => {
      setFocused(false);
      delete document.body.dataset.editing;
    };
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
      delete document.body.dataset.editing;
    };
  }, [editor]);

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

  // List nesting (the mobile Tab-key replacement). Bullet/ordered lists nest
  // their `listItem`; the GFM checklist nests `taskItem` (configured nested:true
  // above). Pick the node type from the active list so one pair of buttons
  // covers all three. Disabled outside a list (see `inList`).
  const inList =
    toolbar.isBulletList || toolbar.isOrderedList || toolbar.isTaskList;
  const indent = () =>
    toolbar.isTaskList
      ? editor.chain().focus().sinkListItem("taskItem").run()
      : editor.chain().focus().sinkListItem("listItem").run();
  const outdent = () =>
    toolbar.isTaskList
      ? editor.chain().focus().liftListItem("taskItem").run()
      : editor.chain().focus().liftListItem("listItem").run();

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

  // Open the hyperlink editor, prefilled with the current link's href if the
  // cursor sits inside one (so the button edits rather than stacks links).
  const openLinkEditor = () => {
    setLinkDraft((editor.getAttributes("link").href as string) || "");
  };

  // Apply the StarterKit Link mark from the editor's draft URL. With a selection
  // (or cursor already in a link) we mark that range; with an empty selection we
  // insert the URL as its own linked text. Bare domains get an https:// scheme.
  const applyLink = (raw: string) => {
    const url = raw.trim();
    setLinkDraft(null);
    if (!url) return;
    const href = /^(https?:|mailto:|tel:|ledgr:|\/|#)/i.test(url)
      ? url
      : `https://${url}`;
    if (editor.state.selection.empty && !editor.isActive("link")) {
      const from = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .insertContent(url)
        .setTextSelection({ from, to: from + url.length })
        .setLink({ href })
        .setTextSelection(from + url.length)
        .unsetMark("link")
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  };

  const removeLink = () => {
    setLinkDraft(null);
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
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
      {/* The formatting toolbar is hidden on a locked item — nothing here can
          act on a read-only document (item lock toggle). */}
      {editable && (
      <div
        className={
          focused
            ? "fixed inset-x-0 z-50 border-t border-neutral-800 bg-neutral-900/95 backdrop-blur sm:static sm:z-auto sm:border-t-0 sm:bg-transparent sm:backdrop-blur-none"
            : "hidden sm:block"
        }
        style={focused ? { bottom: keyboardInset } : undefined}
      >
      <div className={`flex flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain px-1 py-1.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 sm:flex-wrap sm:overflow-visible ${toolbarOpen ? "border-b border-neutral-800/70" : ""}`}>
        {toolbarOpen && (<>{(
          [
            { id: "bold", title: "Bold", icon: TOOLBAR_ICONS.bold, active: toolbar.isBold, run: () => editor.chain().focus().toggleBold().run() },
            { id: "italic", title: "Italic", icon: TOOLBAR_ICONS.italic, active: toolbar.isItalic, run: () => editor.chain().focus().toggleItalic().run() },
            { id: "strike", title: "Strikethrough", icon: TOOLBAR_ICONS.strike, active: toolbar.isStrike, run: () => editor.chain().focus().toggleStrike().run() },
            { id: "h1", title: "Heading 1", label: "H1", active: toolbar.isH1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
            { id: "h2", title: "Heading 2", label: "H2", active: toolbar.isH2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
            { id: "bulletList", title: "Bullet list", icon: TOOLBAR_ICONS.bulletList, active: toolbar.isBulletList, run: () => editor.chain().focus().toggleBulletList().run() },
            { id: "orderedList", title: "Numbered list", icon: TOOLBAR_ICONS.orderedList, active: toolbar.isOrderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
            { id: "tasks", title: "Checklist (- [ ])", icon: TOOLBAR_ICONS.tasks, active: toolbar.isTaskList, run: () => editor.chain().focus().toggleTaskList().run() },
            { id: "outdent", title: "Outdent (un-nest list item)", icon: TOOLBAR_ICONS.outdent, disabled: !inList, run: outdent },
            { id: "indent", title: "Indent (nest list item)", icon: TOOLBAR_ICONS.indent, disabled: !inList, run: indent },
            { id: "quote", title: "Quote", icon: TOOLBAR_ICONS.quote, active: toolbar.isBlockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
            { id: "code", title: "Code block", icon: TOOLBAR_ICONS.code, active: toolbar.isCodeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
            { id: "table", title: "Insert table", icon: TOOLBAR_ICONS.table, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
          ] as { id: string; title: string; icon?: ReactNode; label?: string; active?: boolean; disabled?: boolean; run: () => void }[]
        )
          .filter((b) => showTb(b.id))
          .map((b) => (
            <ToolbarButton key={b.id} icon={b.icon} label={b.label} title={b.title} active={b.active} disabled={b.disabled} onClick={b.run} />
          ))}

        {showTb("image") && uploadImage && (
          <ToolbarButton
            icon={TOOLBAR_ICONS.image}
            title="Insert image (or paste/drop one)"
            onClick={() => fileInputRef.current?.click()}
          />
        )}
        {showTb("weblink") && (
          <ToolbarButton
            icon={TOOLBAR_ICONS.weblink}
            title="Insert link"
            active={toolbar.isLink || linkDraft !== null}
            onClick={openLinkEditor}
          />
        )}
        {showTb("link") && itemId && (
          <ToolbarButton
            icon={TOOLBAR_ICONS.link}
            title="Copy a link to this line (from the cursor)"
            active={linkCopied}
            onClick={() => void copyLineLink()}
          />
        )}

        {(showTb("color") || showTb("highlight")) && (
          <span className="mx-1 h-5 w-px bg-neutral-700" />
        )}

        {showTb("color") && (
          <select
            title="Text color"
            className="rounded bg-neutral-800 px-1 py-1 text-sm text-neutral-200"
            value={toolbar.textColor}
            onChange={(e) => setColor((e.target.value || null) as BlockNoteColor | null)}
          >
            <option value="">Color…</option>
            {COLOR_NAMES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {showTb("highlight") && (
          <select
            title="Highlight"
            className="rounded bg-neutral-800 px-1 py-1 text-sm text-neutral-200"
            value={toolbar.highlight}
            onChange={(e) => setHighlight((e.target.value || null) as BlockNoteColor | null)}
          >
            <option value="">Highlight…</option>
            {COLOR_NAMES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {showTb("mention") && (
          <span className="ml-2 text-xs text-neutral-500">
            Type <kbd className="rounded bg-neutral-800 px-1">@</kbd> to mention
          </span>
        )}</>)}
        {collapsibleToolbar && (
          <button
            type="button"
            onClick={() => setToolbarOpen((v) => !v)}
            title={toolbarOpen ? "Hide formatting" : "Formatting"}
            aria-label={toolbarOpen ? "Hide formatting" : "Formatting"}
            aria-pressed={toolbarOpen}
            className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {toolbarOpen ? <path d="M6 15l6-6 6 6" /> : <><path d="M4 7h16M4 12h10M4 17h13" /></>}
            </svg>
          </button>
        )}
      </div>
      </div>
      )}

      {/* Hyperlink editor: a one-line URL input below the toolbar, open while
          linkDraft is non-null. Enter applies, Escape cancels; Remove clears an
          existing link. Markdown round-trips the resulting [text](url). */}
      {editable && linkDraft !== null && (
        <div className="flex items-center gap-1.5 border-b border-neutral-800/70 px-2 py-1.5">
          <input
            type="url"
            autoFocus
            value={linkDraft}
            placeholder="https://… (or paste a URL)"
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink(linkDraft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setLinkDraft(null);
              }
            }}
            className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-500"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyLink(linkDraft)}
            className="rounded bg-neutral-700 px-2 py-1 text-sm font-medium text-neutral-100 hover:bg-neutral-600"
          >
            Apply
          </button>
          {toolbar.isLink && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeLink}
              className="rounded px-2 py-1 text-sm font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLinkDraft(null)}
            title="Cancel"
            aria-label="Cancel"
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
      )}

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
