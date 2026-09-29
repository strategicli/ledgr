// Collapsible headings AND list items (view-only fold). Headings are flat
// siblings in the schema, so "folding" an H2 means hiding the blocks that follow
// it until the next heading of level <= 2. A list item (bullet, numbered, or
// checklist) folds its own children: everything after its first line (nested
// lists, paragraphs, toggles). Nothing is written to the markdown, so exports,
// FTS, and the server render are untouched. A ProseMirror plugin owns the fold
// state and the decorations, modeled on block-anchor-extension.ts.
//
// The content is hidden with a display:none node decoration — it stays in the
// document, so copy/selection operate on the real range. display:none in
// ProseMirror can strand a caret in invisible content or let an edit delete a
// hidden block unseen, so `apply` AUTO-EXPANDS any fold whose hidden range the
// selection enters: you can never land in, or delete, a section you can't see.
//
// Folds are REMEMBERED PER DEVICE (localStorage, keyed by item id) as text
// fingerprints ("h2:0:Heading text" = kind, occurrence index, line text), never
// positions, so a note edited elsewhere can't fold the wrong line: a fingerprint
// that no longer matches just shows open. Per-device on purpose (Brandon,
// 2026-09-29): storing folds on the item would make every fold an edit (bump
// updated_at, re-export). Toggle blocks are the opposite: their open/closed
// state lives in the note (<details open>), so it follows the note everywhere.
//
// Both kinds are off until the host pushes the user's settings in (via
// setFoldSettings); when a kind is off the plugin renders nothing for it.
"use client";

import { Extension, type Editor } from "@tiptap/core";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

type FoldState = {
  headings: boolean;
  lists: boolean;
  // Start positions of collapsed headings / list items. Remapped through each
  // transaction so they follow edits.
  collapsed: number[];
  // localStorage key for this item's remembered folds (null = don't remember).
  storageKey: string | null;
  // True when THIS transaction changed the folds in a way worth saving (a
  // fold/unfold, Expand all, an edit, an auto-expand). A restore or a
  // whole-document swap is never "touched", so a note that is still loading
  // can't overwrite what was remembered.
  touched: boolean;
};

type FoldMeta = {
  headings?: boolean;
  lists?: boolean;
  storageKey?: string | null;
  toggle?: number;
  expandAll?: boolean;
  restore?: boolean;
};

const key = new PluginKey<FoldState>("collapsibleHeadings");

const HEADING_LEVELS = new Set([1, 2, 3]);
const LIST_ITEMS = new Set(["listItem", "taskItem"]);

function isFoldableHeading(node: PMNode): boolean {
  return node.type.name === "heading" && HEADING_LEVELS.has(node.attrs.level);
}
function isFoldableItem(node: PMNode): boolean {
  return LIST_ITEMS.has(node.type.name);
}

// The [from, to) doc range hidden when the heading/list item at `pos` is
// collapsed. Heading: every top-level block after it up to (not including) the
// next heading of level <= its own. List item: its children after the first.
// null when `pos` is not foldable or nothing would be hidden.
export function hiddenRange(
  doc: PMNode,
  pos: number,
): { from: number; to: number } | null {
  const node = doc.nodeAt(pos);
  if (!node) return null;
  if (isFoldableItem(node)) {
    if (node.childCount < 2) return null;
    const from = pos + 1 + node.child(0).nodeSize;
    return { from, to: pos + node.nodeSize - 1 };
  }
  if (!isFoldableHeading(node)) return null;
  const level = node.attrs.level as number;
  const from = pos + node.nodeSize;
  let to = from;
  let offset = from;
  while (offset < doc.content.size) {
    const child = doc.nodeAt(offset);
    if (!child) break;
    if (child.type.name === "heading" && child.attrs.level <= level) break;
    offset += child.nodeSize;
    to = offset;
  }
  return to > from ? { from, to } : null;
}

// Every foldable position the enabled kinds allow, with its fingerprint.
// Headings fold only at the top level (as before); list items fold at any depth.
function foldables(doc: PMNode, s: Pick<FoldState, "headings" | "lists">) {
  const out: { pos: number; node: PMNode; fp: string }[] = [];
  const seen = new Map<string, number>();
  const push = (pos: number, node: PMNode, kind: string, text: string) => {
    const base = `${kind}:${text}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ pos, node, fp: `${kind}:${n}:${text}` });
  };
  if (s.headings) {
    doc.forEach((node, pos) => {
      if (isFoldableHeading(node))
        push(pos, node, `h${node.attrs.level}`, node.textContent);
    });
  }
  if (s.lists) {
    doc.descendants((node, pos) => {
      if (isFoldableItem(node))
        push(pos, node, "li", node.child(0)?.textContent ?? "");
      return true;
    });
  }
  return out;
}

// Positions whose fingerprints are in `fps` (the restore direction).
export function resolveFingerprints(
  doc: PMNode,
  s: FoldState,
  fps: string[],
): number[] {
  if (!fps.length) return [];
  const want = new Set(fps);
  return foldables(doc, s)
    .filter((f) => want.has(f.fp) && hiddenRange(doc, f.pos))
    .map((f) => f.pos);
}

// Fingerprints of the currently collapsed positions (the save direction).
export function fingerprintsOf(doc: PMNode, s: FoldState): string[] {
  if (!s.collapsed.length) return [];
  const set = new Set(s.collapsed);
  return foldables(doc, s)
    .filter((f) => set.has(f.pos))
    .map((f) => f.fp);
}

function readStored(storageKey: string | null): string[] {
  if (!storageKey) return [];
  try {
    const raw = localStorage.getItem(storageKey);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeStored(storageKey: string, fps: string[]): void {
  try {
    if (fps.length) localStorage.setItem(storageKey, JSON.stringify(fps));
    else localStorage.removeItem(storageKey);
  } catch {
    // Private window / blocked storage: folds just aren't remembered.
  }
}

function foldableAt(doc: PMNode, pos: number, s: FoldState): boolean {
  const n = doc.nodeAt(pos);
  return (
    !!n &&
    ((s.headings && isFoldableHeading(n)) || (s.lists && isFoldableItem(n)))
  );
}

// A whole-document swap (setContent after a server refresh): positional remap
// can't follow it, so the remembered fingerprints are re-resolved instead.
function replacesWholeDoc(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const j = step.toJSON() as {
      stepType?: string;
      from?: number;
      to?: number;
    };
    return (
      j.stepType === "replace" &&
      j.from === 0 &&
      j.to === tr.before.content.size
    );
  });
}

// Pure state transition (exported for verify-collapsible-folds).
export function applyFold(tr: Transaction, value: FoldState): FoldState {
  let { headings, lists, collapsed, storageKey } = value;
  const meta = tr.getMeta(key) as FoldMeta | undefined;
  let restore = false;
  if (meta) {
    if (typeof meta.headings === "boolean") headings = meta.headings;
    if (typeof meta.lists === "boolean") lists = meta.lists;
    if (meta.storageKey !== undefined) storageKey = meta.storageKey;
    if (meta.restore) restore = true;
    if (meta.expandAll) collapsed = [];
    if (typeof meta.toggle === "number") {
      collapsed = collapsed.includes(meta.toggle)
        ? collapsed.filter((p) => p !== meta.toggle)
        : [...collapsed, meta.toggle];
    }
  }
  const touched =
    !!meta && (meta.expandAll === true || typeof meta.toggle === "number");
  const next: FoldState = { headings, lists, collapsed, storageKey, touched };

  const reload = restore || (tr.docChanged && replacesWholeDoc(tr));
  if (reload) {
    next.collapsed = resolveFingerprints(tr.doc, next, readStored(storageKey));
  } else if (tr.docChanged) {
    // An edit can rename a collapsed line (its fingerprint), so it's worth a save.
    if (collapsed.length) next.touched = true;
    // Follow edits: remap positions, then keep only those that still point at
    // a foldable node (dedup so a merge can't double them).
    next.collapsed = [
      ...new Set(collapsed.map((p) => tr.mapping.map(p, -1))),
    ].filter((p) => foldableAt(tr.doc, p, next));
  }

  // Auto-expand any fold whose hidden range the selection now overlaps — so a
  // caret never strands in, and an edit never silently deletes, hidden content.
  if (next.collapsed.length) {
    const sel = tr.selection;
    const before = next.collapsed.length;
    next.collapsed = next.collapsed.filter((p) => {
      const r = hiddenRange(tr.doc, p);
      if (!r) return true;
      return !(sel.from < r.to && sel.to > r.from);
    });
    if (!reload && next.collapsed.length !== before) next.touched = true;
  }
  return next;
}

function buildDecorations(doc: PMNode, state: FoldState): DecorationSet {
  if (!state.headings && !state.lists) return DecorationSet.empty;
  const collapsed = new Set(state.collapsed);
  const decos: Decoration[] = [];
  const hide = (from: number, to: number) => {
    // Hide each whole block in the range (node decorations align to block
    // boundaries, which the range already respects).
    let offset = from;
    while (offset < to) {
      const child = doc.nodeAt(offset);
      if (!child) break;
      decos.push(
        Decoration.node(offset, offset + child.nodeSize, {
          class: "ledgr-fold-hidden",
        }),
      );
      offset += child.nodeSize;
    }
  };
  for (const { pos, node } of foldables(doc, state)) {
    const isCollapsed = collapsed.has(pos);
    const range = hiddenRange(doc, pos);
    // No chevron on a line with nothing beneath it to fold — unless it's
    // somehow marked collapsed, so it can be re-opened.
    if (!range && !isCollapsed) continue;
    // Tag the node ITSELF (a node decoration), never an inline widget: a widget
    // before the first character stole clicks/selection there. The chevron is
    // painted by CSS (`.ledgr-foldable::before` for headings,
    // `.ledgr-foldable-li::before` for list items) in the left gutter; clicks on
    // it are caught by the gutter mousedown handler below (data-fold-pos).
    const cls = isFoldableItem(node) ? "ledgr-foldable-li" : "ledgr-foldable";
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: cls + (isCollapsed ? " is-collapsed" : ""),
        "data-fold-pos": String(pos),
      }),
    );
    if (isCollapsed && range) hide(range.from, range.to);
  }
  return DecorationSet.create(doc, decos);
}

// The gutter chevron dispatches this DOM event (bubbles to the editor root); the
// plugin view listens and turns it into a toggle meta. A DOM event keeps the
// gutter mousedown handler decoupled from the toggle/caret-management logic.
const FOLD_TOGGLE_EVENT = "ledgr-fold-toggle";

// Where a click counts as a fold click:
//  - heading: the chevron lives in the heading's own LEFT PADDING
//    (markdown-editor.css: +ve padding-left, matching -ve margin-left), so the
//    click lands on the heading at clientX within that padding.
//  - list item: the chevron (and the bullet/number marker) sit LEFT of the li's
//    box. The li's ::before takes pointer events, so a click on it targets the
//    li itself with clientX < its left edge. Clicking the bullet also folds,
//    which doubles as a bigger touch target on a phone.
function foldTarget(e: MouseEvent): HTMLElement | null {
  const el = e.target as HTMLElement | null;
  const li = el?.closest?.("li.ledgr-foldable-li") as HTMLElement | null;
  if (li && li === el && e.clientX < li.getBoundingClientRect().left) return li;
  const heading = el?.closest?.(
    "h1.ledgr-foldable, h2.ledgr-foldable, h3.ledgr-foldable",
  ) as HTMLElement | null;
  if (!heading) return null;
  const rect = heading.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(heading).paddingLeft) || 0;
  if (e.clientX < rect.left || e.clientX > rect.left + pad) return null;
  return heading;
}

// The plugin itself (exported so verify-collapsible-folds can run it headless).
export function foldPlugin(): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key,
    state: {
      init: () => ({
        headings: false,
        lists: false,
        collapsed: [],
        storageKey: null,
        touched: false,
      }),
      apply: applyFold,
    },
    props: {
      decorations(state) {
        const s = key.getState(state);
        return s ? buildDecorations(state.doc, s) : null;
      },
    },
    view: (editorView) => {
      // mousedown (not click) so we can preventDefault before the caret moves.
      const gutter = (e: MouseEvent) => {
        const target = foldTarget(e);
        if (!target) return;
        const pos = Number(target.getAttribute("data-fold-pos"));
        if (!Number.isFinite(pos)) return;
        e.preventDefault();
        e.stopPropagation();
        target.dispatchEvent(
          new CustomEvent(FOLD_TOGGLE_EVENT, {
            detail: { pos },
            bubbles: true,
          }),
        );
      };
      const handler = (e: Event) => {
        const pos = (e as CustomEvent<{ pos: number }>).detail?.pos;
        if (typeof pos !== "number") return;
        const st = key.getState(editorView.state);
        const tr = editorView.state.tr;
        // When explicitly collapsing, move the caret out of the section
        // first (to the fold line) if it sits inside — otherwise the
        // auto-expand guard would immediately undo this fold.
        const willCollapse = !st || !st.collapsed.includes(pos);
        if (willCollapse) {
          const r = hiddenRange(editorView.state.doc, pos);
          const sel = editorView.state.selection;
          if (r && sel.from < r.to && sel.to > r.from) {
            tr.setSelection(
              TextSelection.near(
                tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size)),
              ),
            );
          }
        }
        editorView.dispatch(tr.setMeta(key, { toggle: pos }));
      };
      editorView.dom.addEventListener(FOLD_TOGGLE_EVENT, handler);
      editorView.dom.addEventListener("mousedown", gutter);
      // Remember folds: write this item's fingerprints after a real change.
      return {
        update: (view) => {
          const s = key.getState(view.state);
          if (!s?.touched || !s.storageKey) return;
          writeStored(s.storageKey, fingerprintsOf(view.state.doc, s));
        },
        destroy: () => {
          editorView.dom.removeEventListener(FOLD_TOGGLE_EVENT, handler);
          editorView.dom.removeEventListener("mousedown", gutter);
        },
      };
    },
  });
}

export const CollapsibleHeadings = Extension.create({
  name: "collapsibleHeadings",
  addProseMirrorPlugins() {
    return [foldPlugin()];
  },
});

// Headless handles for the verify script: the plugin key (state + meta).
export const foldKey = key;

// Push the user's settings in (collapsibleHeadingsEnabled /
// collapsibleListsEnabled) and which item's folds to remember, then restore
// them. The host calls this once settings load.
export function setFoldSettings(
  editor: Editor,
  opts: { headings: boolean; lists: boolean; itemId?: string | null },
): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(key, {
      headings: opts.headings,
      lists: opts.lists,
      storageKey: opts.itemId ? `ledgr:folds:${opts.itemId}` : null,
      restore: true,
    } satisfies FoldMeta),
  );
}

// Open every collapsed heading and list item (the item menu's "Expand all").
// The save hook then forgets this item's remembered folds.
export function expandAllFolds(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(key, { expandAll: true } satisfies FoldMeta),
  );
}
