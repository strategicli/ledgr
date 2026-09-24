// Live in-place updates (in-app agent, Feature 0). When the body changes
// elsewhere (Claude over MCP, the in-app agent, another device), the open editor
// used to reload the whole page, which dropped the owner back at the top. This
// patches only what changed: parse the new markdown into a document, find the
// first and last differing positions with ProseMirror's own fragment diff, and
// replace just that slice in one transaction. ProseMirror maps the cursor and
// selection through the change; a viewport anchor keeps what the owner is
// reading at the same spot on screen when the change sits above it.
//
// The transaction is marked preventUpdate (so it never reads as a user edit and
// saves) and addToHistory:false (so Ctrl+Z undoes the owner's own edits, not
// the incoming change).
import { Extension, createDocument, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const flashKey = new PluginKey<DecorationSet>("ledgrLiveFlash");
const FLASH_MS = 3000;

// A soft highlight over a patched range that fades out (CSS: .ledgr-live-flash).
export const LiveFlash = Extension.create({
  name: "ledgrLiveFlash",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(flashKey) as { from: number; to: number } | "clear" | undefined;
            if (meta === "clear") return DecorationSet.empty;
            set = set.map(tr.mapping, tr.doc);
            if (meta && meta.to > meta.from) {
              set = set.add(tr.doc, [Decoration.inline(meta.from, meta.to, { class: "ledgr-live-flash" })]);
            }
            return set;
          },
        },
        props: { decorations: (state) => flashKey.getState(state) },
      }),
    ];
  },
});

// The nearest scrolling ancestor, or null for the window.
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function viewportTop(sc: HTMLElement | null): number {
  return sc ? sc.getBoundingClientRect().top : 0;
}

// The first top-level block visible at the top of the viewport, and its offset.
function anchorBlock(dom: HTMLElement, sc: HTMLElement | null) {
  const top = viewportTop(sc);
  const kids = Array.from(dom.children) as HTMLElement[];
  const i = kids.findIndex((k) => k.getBoundingClientRect().bottom > top);
  if (i < 0) return null;
  return { i, text: kids[i].textContent ?? "", offset: kids[i].getBoundingClientRect().top };
}

export type PatchResult = {
  // Where the change landed relative to the viewport, for the "Edited above/
  // below" pill; null when it's on screen (or nothing changed).
  offscreen: "above" | "below" | null;
  // Scroll the patched range into view.
  reveal: () => void;
} | null;

// Apply `markdown` to the editor in place. Returns null when nothing changed.
export function patchMarkdown(editor: Editor, markdown: string): PatchResult {
  const mgr = (editor as unknown as { markdown?: { parse(md: string): unknown } }).markdown;
  if (!mgr) return null;
  const next = createDocument(mgr.parse(markdown) as never, editor.schema, {}, { errorOnInvalidContent: false });
  const cur = editor.state.doc;
  const start = cur.content.findDiffStart(next.content);
  if (start == null) return null;
  let { a: endA, b: endB } = cur.content.findDiffEnd(next.content)!;
  // findDiffEnd can overlap findDiffStart on repeated text; the standard fix.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }

  const dom = editor.view.dom as HTMLElement;
  const sc = scroller(dom);
  const before = anchorBlock(dom, sc);

  const tr = editor.state.tr
    .replace(start, endA, next.slice(start, endB))
    .setMeta("preventUpdate", true)
    .setMeta("addToHistory", false)
    .setMeta(flashKey, { from: start, to: endB });
  editor.view.dispatch(tr);
  setTimeout(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(flashKey, "clear"));
  }, FLASH_MS);

  // Hold the reading position: find the same block again (by text, else index)
  // and scroll by however far it moved. A no-op when the browser's own scroll
  // anchoring already held it.
  if (before) {
    const kids = Array.from(dom.children) as HTMLElement[];
    const same = kids.find((k, j) => Math.abs(j - before.i) < 50 && (k.textContent ?? "") === before.text) ?? kids[before.i];
    if (same) {
      const delta = same.getBoundingClientRect().top - before.offset;
      if (Math.abs(delta) > 1) {
        if (sc) sc.scrollTop += delta;
        else window.scrollBy(0, delta);
      }
    }
  }

  let coords: { top: number; bottom: number } | null = null;
  try {
    coords = editor.view.coordsAtPos(Math.min(start, editor.state.doc.content.size));
  } catch {
    coords = null;
  }
  const top = viewportTop(sc);
  const bottom = sc ? sc.getBoundingClientRect().bottom : window.innerHeight;
  const offscreen = !coords ? null : coords.bottom < top ? "above" : coords.top > bottom ? "below" : null;
  return {
    offscreen,
    reveal: () => {
      try {
        const { node } = editor.view.domAtPos(Math.min(start, editor.state.doc.content.size));
        const el = node instanceof HTMLElement ? node : node.parentElement;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        // The range was edited away; nothing to reveal.
      }
    },
  };
}
