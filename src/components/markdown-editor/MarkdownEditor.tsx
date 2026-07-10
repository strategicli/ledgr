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
import { useIsDesktop } from "./useIsDesktop";
import { useRouter } from "next/navigation";
import {
  BLOCKNOTE_COLORS,
  type BlockNoteColor,
} from "@/lib/colors";
import {
  Highlight,
  LedgrImage,
  LedgrMention,
  LedgrPassage,
  LedgrTable,
  TableCell,
  TableHeader,
  TableRow,
  TextColor,
} from "./extensions";
import { createMentionSuggestion } from "./mention-suggestion";
import { ItemTokenDecoration } from "./token-decoration";
import { ItemTokenSuggestion } from "./token-suggestion";
import {
  Toggle,
  ToggleSummary,
  ToggleContent,
  insertToggle,
  wrapSelectionInToggle,
} from "./toggle-extension";
import {
  CollapsibleHeadings,
  setHeadingsCollapsible,
} from "./collapsible-headings";
import { SlashCommands, setSlashToggleEnabled } from "./slash-suggestion";
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
import { deskSendAvailable, openDeskSendMenu } from "@/lib/desk/send";
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
  // Controlled visibility of the formatting bar on desktop (S5): the collapse
  // toggle now lives in BodyEditor's mode-row, which owns this state (and its
  // per-item persistence). When false the bar renders NOTHING on desktop (zero
  // height — no empty reserved strip); on mobile the bar always shows regardless,
  // since the collapse affordance is desktop-only. Default true = always shown,
  // for the direct callers (scratch, changelog) that have no mode-row.
  toolbarOpen?: boolean;
  // Desktop only: the body's view-mode controls (Rich/Source/Preview pill +
  // collapse toggle), rendered right-aligned on the SAME row as the formatting
  // buttons so the two read as one bar (ADR-125 mode switch, merged in S8). The
  // caller (BodyEditor) owns the markup and its own visibility; MarkdownEditor
  // just docks it. When set, the bar always renders (even with the formatting
  // buttons collapsed) so the toggle stays reachable. Direct callers pass none.
  viewControls?: ReactNode;
  // When true, the editor has no tall min-height: it starts one line tall and
  // grows with content (the task canvas, where bodies are short). Default false
  // keeps the roomy 14rem writing area.
  compact?: boolean;
  // When false (a locked item, item lock toggle): the body is read-only.
  // Tiptap drops contenteditable so the cursor can't enter, and the toolbar is
  // hidden — the document still renders, it just can't be changed. Defaults true.
  editable?: boolean;
  // Imperative focus signal: a monotonically increasing counter the host bumps to
  // move the caret INTO the editor (the title's Enter → jump to the body). The
  // mount value 0 means "don't focus", so a normal load never steals focus; each
  // increment focuses once. Defaults 0.
  focusSignal?: number;
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

// Editor settings the canvas needs (app-wide): the hidden-toolbar ids plus the
// two feature switches. Fetched once per page load (memoized) so every editor
// instance shares the single request.
type EditorSettings = {
  hidden: string[];
  collapsibleHeadings: boolean;
  toggleBlocks: boolean;
};
let editorSettingsPromise: Promise<EditorSettings> | null = null;
function loadEditorSettings(): Promise<EditorSettings> {
  editorSettingsPromise ??= fetch("/api/settings")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const s = d?.settings ?? {};
      return {
        hidden: Array.isArray(s.editorToolbarHidden)
          ? (s.editorToolbarHidden as string[])
          : [],
        // Default on when the field is absent (matches DEFAULT_SETTINGS).
        collapsibleHeadings: s.collapsibleHeadingsEnabled !== false,
        toggleBlocks: s.toggleBlocksEnabled !== false,
      };
    })
    .catch(() => ({ hidden: [], collapsibleHeadings: true, toggleBlocks: true }));
  return editorSettingsPromise;
}

// Shared ghost-button look for every toolbar control (formatting buttons + the
// swatch controls), on the refreshed token layer (ADR-141): quiet idle ink, a
// surface-2 wash on hover/active. Kept in one place so the two control kinds
// can't drift apart.
function toolbarBtnClass(active?: boolean, disabled?: boolean) {
  return `flex h-7 min-w-[28px] items-center justify-center rounded-md px-1.5 text-sm font-medium ${
    disabled
      ? "cursor-default text-ink-faint"
      : active
        ? "bg-surface-2 text-ink"
        : "text-ink-subtle hover:bg-surface-2 hover:text-ink"
  }`;
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
      className={toolbarBtnClass(active, disabled)}
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
  toolbarOpen = true,
  viewControls,
  compact = false,
  editable = true,
  focusSignal = 0,
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

  // The last markdown this editor emitted upward, seeded (in onCreate) with the
  // editor's OWN canonical serialization of the loaded body. Tiptap re-emits the
  // body once on mount (a programmatic transaction), and its serialization is
  // rarely byte-identical to the stored markdown — a Notion import uses `*`/`1)`
  // bullets, extra blank lines, etc., which round-trip to `-`/`1.` and single
  // blanks. Comparing that mount re-emit against the *stored* string (as the
  // autosave dedup does) misses, so merely opening an item PATCHed a normalized
  // body and bumped its edit date + burned a revision — the "viewing an item
  // marks it edited" bug. Comparing against the canonical baseline instead makes
  // the mount re-emit a true no-op; only a real user edit differs and saves.
  const lastEmitted = useRef<string | null>(null);

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
      // Empty-state hint: a quiet prompt while the body is empty, the first
      // impression of every new note. First-party (@tiptap/extensions), styled
      // via the is-editor-empty class in markdown-editor.css. The "/" hint points
      // at the slash-command menu (SlashCommands, below).
      Placeholder.configure({ placeholder: "Start writing, or press / for commands…" }),
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
      // Passage @/refs (ADR-149) share the "@" picker via the /ref scope; the
      // node reclaims its own ledgr://passage/ links on parse. Additive to the
      // mention node above.
      LedgrPassage,
      // Live item tokens (LT2, ADR-139): highlight recognized {{item.*}} tokens
      // and offer a `{{` insert menu. Tokens stay plain text — decoration only.
      ItemTokenDecoration,
      ItemTokenSuggestion,
      // Collapsible "toggle" block (<details>). The three nodes are always
      // registered so existing bodies with toggles parse; the toolbar button and
      // "/toggle" command (the creation paths) are gated by toggleBlocksEnabled.
      Toggle,
      ToggleSummary,
      ToggleContent,
      // Collapsible headings (view-only fold). Enabled/disabled at runtime from
      // the user's collapsibleHeadingsEnabled setting (dispatched below).
      CollapsibleHeadings,
      // The "/" slash-command menu (headings + toggle). Toggle entry gated by
      // toggleBlocksEnabled (setSlashToggleEnabled below).
      SlashCommands,
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
    // Backstop for the common ordering: seed the baseline with the canonical
    // serialization at creation. Under immediatelyRender:false the mount re-emit
    // can fire onUpdate *before* onCreate, so the null-guard below is what
    // actually catches it — this just keeps the baseline correct when onCreate
    // does win the race.
    onCreate: ({ editor }) => {
      if (lastEmitted.current === null) lastEmitted.current = editor.getMarkdown();
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      // First emission after mount establishes the baseline WITHOUT saving. Tiptap
      // re-serializes the loaded body once on mount (a programmatic transaction),
      // and that serialization is rarely byte-identical to the stored markdown — a
      // Notion import's `*`/`1)` bullets and double blanks round-trip to `-`/`1.`
      // and single blanks. Treating that first emit (or any emit equal to the
      // baseline) as a save is the "viewing an item marks it edited" bug: it
      // PATCHed a normalized body and bumped the edit date + burned a revision.
      // The user can't have edited before the editor mounted, so the first emit is
      // always this programmatic one — adopt it, don't persist it. A real edit
      // differs from the baseline and saves normally.
      if (lastEmitted.current === null || md === lastEmitted.current) {
        lastEmitted.current = md;
        return;
      }
      lastEmitted.current = md;
      onChangeRef.current(md);
    },
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
      isToggle: editor?.isActive("toggle") ?? false,
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
        .querySelectorAll(".ledgr-mention-popup, .ledgr-slash-popup")
        .forEach((n) => n.remove());
    };
  }, []);

  // Hand the editor up once it exists, for hosts that drive imperative inserts.
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  // Imperative focus (title Enter → jump into the body): when the host bumps
  // focusSignal, move the caret to the start of the body. Guarded on a truthy
  // signal so the mount value (0) can't steal focus on a normal load; each later
  // increment focuses once. No-op on a locked/read-only editor.
  useEffect(() => {
    if (!editor || !focusSignal || !editable) return;
    editor.commands.focus("start");
  }, [editor, focusSignal, editable]);

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

  // Right-click a mention chip → the Send-to-Desk menu (S3b, ADR-146), with this
  // item as "current" so "Open beside" puts the host left and the mention right.
  // Desktop-only; otherwise the native context menu is left alone.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      if (!deskSendAvailable()) return;
      const chip = (e.target as Element).closest?.(
        ".ledgr-mention[data-item-id]"
      ) as HTMLElement | null;
      const linkedId = chip?.dataset.itemId;
      if (!linkedId) return;
      e.preventDefault();
      openDeskSendMenu({
        itemId: linkedId,
        currentItemId: itemId,
        x: e.clientX,
        y: e.clientY,
      });
    };
    dom.addEventListener("contextmenu", handler);
    return () => dom.removeEventListener("contextmenu", handler);
  }, [editor, itemId]);

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
  // Toggle-block creation gate (toolbar button + slash command). Default on;
  // the fetched setting narrows it. Held in state so the toolbar re-renders.
  const [toggleBlocksOn, setToggleBlocksOn] = useState(true);
  useEffect(() => {
    loadEditorSettings().then((s) => {
      setHiddenTb(new Set(s.hidden));
      setToggleBlocksOn(s.toggleBlocks);
      // Gate the "/toggle" slash entry (module-level flag) and switch heading
      // folding on/off in the plugin, now that the setting has resolved.
      setSlashToggleEnabled(s.toggleBlocks);
      if (editor) setHeadingsCollapsible(editor, s.collapsibleHeadings);
    });
  }, [editor]);
  const showTb = (id: string) => !hiddenTb.has(id);
  // Collapse is a DESKTOP affordance only (the toggle lives in BodyEditor's
  // mode-row). On mobile the toolbar floats over the keyboard and must always
  // show its buttons — collapsing it there would leave an empty bar (the mobile
  // regression this guards against). So below `sm`, buttons always render; on
  // desktop the controlled `toolbarOpen` decides, and when it's false the whole
  // bar renders nothing (no reserved strip).
  const isDesktop = useIsDesktop();
  const showToolbarButtons = toolbarOpen || !isDesktop;
  // The merged bar pins at the scroll container's top (its --nav-pt is 0 inside
  // the item modal; on a full page it clears the docked top nav). The mode-row
  // no longer stacks above it — the view controls ride the same row.
  const stickyTop = "sm:top-[var(--nav-pt,0px)]";
  // Which color popover is open (text color / highlight), or null. Only one at a
  // time; a full-viewport backdrop closes it on an outside click.
  const [openSwatch, setOpenSwatch] = useState<null | "color" | "highlight">(null);

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

  // The two color controls (text color, highlight): a ghost button showing a
  // swatch of the current value that opens a popover of the 9 Notion colors
  // (ADR-155). Replaces the OS-native <select>s, which read as foreign chrome
  // in the toolbar. `hex` is the color's text stroke for the "color" kind and
  // its highlight fill for the "highlight" kind.
  const swatchHex = (kind: "color" | "highlight", c: BlockNoteColor) =>
    kind === "color" ? BLOCKNOTE_COLORS[c].text : BLOCKNOTE_COLORS[c].background;
  const swatchControl = (
    kind: "color" | "highlight",
    current: string,
    onPick: (c: BlockNoteColor | null) => void
  ) => {
    const open = openSwatch === kind;
    const title = kind === "color" ? "Text color" : "Highlight";
    // Mobile: the formatting bar is a horizontally-scrolling strip pinned above
    // the keyboard, so an absolutely-positioned popover would be clipped by the
    // scroll container (overflow-x:auto forces overflow-y:auto) and would open
    // down into the keyboard. Fall back to a native <select> — the OS picker is
    // unclipped, keyboard-safe, and idiomatic on touch. Desktop gets the swatch
    // popover below.
    if (!isDesktop) {
      return (
        <select
          title={title}
          aria-label={title}
          className="h-7 rounded-md bg-surface-2 px-1 text-sm text-ink-muted"
          value={current}
          onChange={(e) => onPick((e.target.value || null) as BlockNoteColor | null)}
        >
          <option value="">{title}</option>
          {COLOR_NAMES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      );
    }
    return (
      <div className="relative">
        <button
          type="button"
          title={title}
          aria-label={title}
          aria-haspopup="true"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpenSwatch(open ? null : kind)}
          className={toolbarBtnClass(open || !!current)}
        >
          <span className="flex items-center gap-1">
            {kind === "color" ? (
              <span className="text-sm font-semibold leading-none">A</span>
            ) : (
              <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{TOOLBAR_ICONS.highlight}</span>
            )}
            <span
              className="h-1 w-3.5 rounded-full"
              style={{
                backgroundColor: current
                  ? swatchHex(kind, current as BlockNoteColor)
                  : "var(--line-strong, #444)",
              }}
            />
          </span>
        </button>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onMouseDown={() => setOpenSwatch(null)}
            />
            <div className="absolute right-0 top-full z-50 mt-1 flex w-max items-center gap-1 rounded-card border border-line bg-surface-3 p-1.5 shadow-lg sm:left-0 sm:right-auto">
              <button
                type="button"
                title="None"
                aria-label="No color"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(null);
                  setOpenSwatch(null);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-xs text-ink-subtle ring-1 ring-line hover:text-ink"
              >
                ✕
              </button>
              {COLOR_NAMES.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(c);
                    setOpenSwatch(null);
                  }}
                  className={`h-6 w-6 rounded ring-1 ring-line ${
                    current === c ? "ring-2 ring-ink" : ""
                  }`}
                  style={{ backgroundColor: swatchHex(kind, c) }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    );
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

  // Open the hidden file picker behind the toolbar's Image button.
  const openImagePicker = () => fileInputRef.current?.click();

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

  // Formatting buttons in visual groups (text · headings · lists · blocks ·
  // insert), each rendered as a cluster with a hairline between clusters, so the
  // long run of icons reads in chunks instead of one undifferentiated strip. A
  // group with every button hidden (per-button visibility / feature gates) drops
  // out, and its separator with it.
  type Btn = { id: string; title: string; icon?: ReactNode; label?: string; active?: boolean; disabled?: boolean; when?: boolean; run: () => void };
  const groups: Btn[][] = [
    [
      { id: "bold", title: "Bold", icon: TOOLBAR_ICONS.bold, active: toolbar.isBold, run: () => editor.chain().focus().toggleBold().run() },
      { id: "italic", title: "Italic", icon: TOOLBAR_ICONS.italic, active: toolbar.isItalic, run: () => editor.chain().focus().toggleItalic().run() },
      { id: "strike", title: "Strikethrough", icon: TOOLBAR_ICONS.strike, active: toolbar.isStrike, run: () => editor.chain().focus().toggleStrike().run() },
    ],
    [
      { id: "h1", title: "Heading 1", label: "H1", active: toolbar.isH1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
      { id: "h2", title: "Heading 2", label: "H2", active: toolbar.isH2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    ],
    [
      { id: "bulletList", title: "Bullet list", icon: TOOLBAR_ICONS.bulletList, active: toolbar.isBulletList, run: () => editor.chain().focus().toggleBulletList().run() },
      { id: "orderedList", title: "Numbered list", icon: TOOLBAR_ICONS.orderedList, active: toolbar.isOrderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
      { id: "tasks", title: "Checklist (- [ ])", icon: TOOLBAR_ICONS.tasks, active: toolbar.isTaskList, run: () => editor.chain().focus().toggleTaskList().run() },
      { id: "outdent", title: "Outdent (un-nest list item)", icon: TOOLBAR_ICONS.outdent, disabled: !inList, run: outdent },
      { id: "indent", title: "Indent (nest list item)", icon: TOOLBAR_ICONS.indent, disabled: !inList, run: indent },
    ],
    [
      { id: "quote", title: "Quote", icon: TOOLBAR_ICONS.quote, active: toolbar.isBlockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
      { id: "code", title: "Code block", icon: TOOLBAR_ICONS.code, active: toolbar.isCodeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
      { id: "table", title: "Insert table", icon: TOOLBAR_ICONS.table, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: "toggle", title: "Toggle (collapsible block; wraps the selection)", icon: TOOLBAR_ICONS.toggle, when: toggleBlocksOn, active: toolbar.isToggle, run: () => {
        const sel = editor.state.selection;
        if (!sel.empty && wrapSelectionInToggle(editor)) return;
        insertToggle(editor);
      } },
    ],
  ];
  const visibleGroups = groups
    .map((g) => g.filter((b) => showTb(b.id) && b.when !== false))
    .filter((g) => g.length > 0);
  // The insert cluster (image / link / line-link) is rendered explicitly rather
  // than in the data array: its handlers read a DOM ref (the file input) / the
  // clipboard, which the refs lint rule won't allow inside a mapped structure.
  const showImage = showTb("image") && !!uploadImage;
  const showWeblink = showTb("weblink");
  const showCopyLink = showTb("link") && !!itemId;
  const hasInsert = showImage || showWeblink || showCopyLink;
  const showColor = showTb("color");
  const showHighlight = showTb("highlight");
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />;

  return (
    <div className="border-b border-line">
      {/* The formatting bar is hidden on a locked item (nothing here can act on a
          read-only document). On desktop it merges with the body's view-mode
          controls (viewControls, right-aligned) into one bar; when the collapse
          toggle has hidden the formatting buttons, the bar still renders so the
          toggle and view pill stay reachable. Desktop: sticky so it stays with a
          long note, opaque surface so scrolled text doesn't bleed through, pinned
          at --nav-pt (0 inside the item modal, top-nav height on a full page).
          Mobile: the formatting buttons float above the keyboard (fixed, bottom);
          the view controls live in a separate top row the host renders, so
          viewControls is desktop-only here. */}
      {editable && (showToolbarButtons || viewControls) && (
      <div
        className={
          focused
            ? `fixed inset-x-0 z-50 border-t border-line bg-neutral-900/95 backdrop-blur sm:sticky sm:inset-x-auto ${stickyTop} sm:z-30 sm:border-t-0 sm:bg-surface-1 sm:backdrop-blur-none`
            : `hidden sm:sticky ${stickyTop} sm:z-30 sm:block sm:bg-surface-1`
        }
        style={focused && !isDesktop ? { bottom: keyboardInset } : undefined}
      >
      <div className="flex flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain px-2 py-1.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 sm:flex-wrap sm:overflow-visible">
        {showToolbarButtons && (
          <>
            {visibleGroups.map((g, gi) => (
              <div key={g[0].id} className="flex items-center gap-0.5">
                {gi > 0 && sep}
                {g.map((b) => (
                  <ToolbarButton key={b.id} icon={b.icon} label={b.label} title={b.title} active={b.active} disabled={b.disabled} onClick={b.run} />
                ))}
              </div>
            ))}

            {hasInsert && (
              <div className="flex items-center gap-0.5">
                {visibleGroups.length > 0 && sep}
                {showImage && (
                  <ToolbarButton icon={TOOLBAR_ICONS.image} title="Insert image (or paste/drop one)" onClick={openImagePicker} />
                )}
                {showWeblink && (
                  <ToolbarButton icon={TOOLBAR_ICONS.weblink} title="Insert link" active={toolbar.isLink || linkDraft !== null} onClick={openLinkEditor} />
                )}
                {showCopyLink && (
                  <ToolbarButton icon={TOOLBAR_ICONS.link} title="Copy a link to this line (from the cursor)" active={linkCopied} onClick={() => void copyLineLink()} />
                )}
              </div>
            )}

            {(showColor || showHighlight) && (
              <div className="flex items-center gap-0.5">
                {(visibleGroups.length > 0 || hasInsert) && sep}
                {showColor && swatchControl("color", toolbar.textColor, setColor)}
                {showHighlight && swatchControl("highlight", toolbar.highlight, setHighlight)}
              </div>
            )}

            {showTb("mention") && (
              <span className="ml-2 text-xs text-ink-subtle">
                Type <kbd className="rounded bg-surface-2 px-1">@</kbd> to mention
              </span>
            )}
          </>
        )}

        {viewControls && (
          <div className="ml-auto hidden items-center gap-1 pl-2 sm:flex">
            {viewControls}
          </div>
        )}
      </div>
      </div>
      )}

      {/* Hyperlink editor: a one-line URL input below the toolbar, open while
          linkDraft is non-null. Enter applies, Escape cancels; Remove clears an
          existing link. Markdown round-trips the resulting [text](url). */}
      {editable && linkDraft !== null && (
        <div className="flex items-center gap-1.5 border-b border-line bg-surface-1 px-2 py-1.5">
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
