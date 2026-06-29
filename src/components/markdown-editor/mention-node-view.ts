// The in-editor mention chip (type-aware mentions). A ProseMirror NodeView so
// the chip can do what a static renderHTML can't: show the target type's glyph
// resolved live from the DB, navigate to the item on click, and — for a task —
// toggle done in place from its checkbox.
//
// The type/icon/status is NOT in the markdown (the body stays just
// `[@Title](ledgr://item/<id>)`). It's resolved into editor.storage.mention by
// MarkdownEditor (a batch GET /api/items?ids= on load and after edits); this view
// reads that store and re-renders when it changes. A freshly inserted mention
// carries its type key on the node attrs (from the suggestion) so it's glyphed
// instantly, before the backfill fills in the icon and status.
"use client";

import type { Editor, NodeViewRendererProps } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { OPEN_ITEM_EVENT } from "./block-anchor-extension";
import { mentionGlyphSvg, isTaskMention } from "@/lib/mention-glyph";
import type { ResolvedMention } from "@/lib/mentions";

// The shape stored under editor.storage.mention. `resolved` is the live id→meta
// map; `rerender` holds each mounted chip's repaint callback so a store update
// (backfill or a done-toggle) refreshes every chip; `ready` flips true after the
// first backfill so an unresolved id can be shown as "missing" (vs. not-yet-loaded).
export type MentionStorage = {
  resolved: Map<string, ResolvedMention>;
  rerender: Set<() => void>;
  ready: boolean;
};

export function mentionStorage(editor: Editor): MentionStorage {
  return (editor.storage as unknown as Record<string, MentionStorage>).mention;
}

// Toggle a task mention's completion optimistically: flip the stored status and
// repaint now, POST /complete, reconcile with the server's status, revert on
// failure. Reuses the same endpoint the task-list done-checkbox uses.
async function toggleDone(store: MentionStorage, id: string) {
  const before = store.resolved.get(id);
  if (!before) return;
  const optimistic = before.statusCategory === "done" ? "not_started" : "done";
  store.resolved.set(id, { ...before, statusCategory: optimistic });
  store.rerender.forEach((fn) => fn());
  try {
    const res = await fetch(`/api/items/${id}/complete`, { method: "POST" });
    if (!res.ok) throw new Error(`complete failed (${res.status})`);
    const { item } = (await res.json()) as { item?: { statusCategory?: string } };
    const latest = store.resolved.get(id);
    if (latest && item?.statusCategory) {
      store.resolved.set(id, { ...latest, statusCategory: item.statusCategory });
      store.rerender.forEach((fn) => fn());
    }
  } catch {
    const latest = store.resolved.get(id);
    if (latest) {
      store.resolved.set(id, { ...latest, statusCategory: before.statusCategory });
      store.rerender.forEach((fn) => fn());
    }
  }
}

export function createMentionNodeView(props: NodeViewRendererProps) {
  const editor = props.editor;
  let node = props.node as PMNode;

  const dom = document.createElement("span");
  dom.className = "ledgr-mention";

  const render = () => {
    const id: string = typeof node.attrs.id === "string" ? node.attrs.id : "";
    const label: string = node.attrs.label || "untitled";
    const store = mentionStorage(editor);
    const resolved = id ? store.resolved.get(id) : undefined;
    // type key: resolved wins, else the attr the suggestion set at insert time.
    const type =
      resolved?.type ??
      (typeof node.attrs.type === "string" ? node.attrs.type : null);
    const missing = !!id && store.ready && !resolved && !type;

    dom.dataset.itemId = id;
    if (type) dom.dataset.itemType = type;
    else delete dom.dataset.itemType;
    dom.classList.toggle("ledgr-mention--missing", missing);

    dom.innerHTML = "";
    const isTask = isTaskMention(type);
    const done = resolved?.statusCategory === "done";
    const icon = document.createElement("span");
    icon.className =
      "ledgr-mention-icon" + (isTask ? " ledgr-mention-check" : "");
    icon.innerHTML = mentionGlyphSvg({
      type,
      icon: resolved?.icon ?? null,
      statusCategory: resolved?.statusCategory ?? null,
    });
    if (isTask && id) {
      icon.setAttribute("role", "button");
      icon.setAttribute("aria-label", done ? "Mark task not done" : "Mark task done");
      icon.dataset.done = done ? "1" : "0";
      // Keep the click from selecting the node or navigating; just toggle.
      icon.addEventListener("mousedown", (e) => e.preventDefault());
      icon.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleDone(mentionStorage(editor), id);
      });
    }
    dom.appendChild(icon);
    dom.appendChild(document.createTextNode(`@${label}`));
  };

  render();
  const repaint = () => render();
  mentionStorage(editor).rerender.add(repaint);

  // Click the chip (outside the checkbox) → open the item via the editor's
  // existing OPEN_ITEM_EVENT (MarkdownEditor turns it into an SPA navigation).
  dom.addEventListener("click", (e) => {
    const id: string = typeof node.attrs.id === "string" ? node.attrs.id : "";
    if (!id) return;
    e.preventDefault();
    dom.dispatchEvent(
      new CustomEvent(OPEN_ITEM_EVENT, { detail: { itemId: id }, bubbles: true })
    );
  });

  return {
    dom,
    update(updated: PMNode) {
      if (updated.type !== node.type) return false;
      node = updated;
      render();
      return true;
    },
    destroy() {
      mentionStorage(editor).rerender.delete(repaint);
    },
    // Atom leaf with bespoke DOM: ignore internal DOM mutations.
    ignoreMutation: () => true,
  };
}
