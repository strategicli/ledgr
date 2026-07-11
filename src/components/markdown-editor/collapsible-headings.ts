// Collapsible headings (view-only fold). Headings are flat siblings in the
// schema, so "folding" an H2 means hiding the blocks that follow it until the
// next heading of level <= 2. This is PURELY an editor view concern: nothing is
// written to the markdown (headings stay `# Heading`), so exports, FTS, and the
// server render are untouched. A ProseMirror plugin owns the fold state and the
// decorations, modeled on block-anchor-extension.ts.
//
// The content is hidden with a display:none node decoration — it stays in the
// document, so copy/selection operate on the real range (⌘A grabs a folded
// section; copying just the heading line does not, because the section is a
// sibling, not a child). display:none in ProseMirror can strand a caret in
// invisible content or let an edit delete a hidden block unseen, so `apply`
// AUTO-EXPANDS any collapsed heading whose hidden range the selection enters:
// you can never land in, or delete, a section you can't see.
//
// The `enabled` flag is off until the host pushes the user's setting in (via
// setHeadingsCollapsible); when off the plugin renders nothing and every
// heading shows normally.
"use client";

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

type HeadingsState = {
  enabled: boolean;
  // Start positions of collapsed headings (top-level doc offsets). Remapped
  // through each transaction so they follow edits.
  collapsed: number[];
};

const key = new PluginKey<HeadingsState>("collapsibleHeadings");

const HEADING_LEVELS = new Set([1, 2, 3]);

function isFoldableHeading(node: PMNode): boolean {
  return node.type.name === "heading" && HEADING_LEVELS.has(node.attrs.level);
}

// The [from, to) doc range hidden when the heading at `pos` is collapsed: every
// top-level block after the heading up to (not including) the next heading of
// level <= its own. null when `pos` is not a foldable heading or nothing
// follows it.
function hiddenRange(
  doc: PMNode,
  pos: number
): { from: number; to: number; level: number } | null {
  const heading = doc.nodeAt(pos);
  if (!heading || !isFoldableHeading(heading)) return null;
  const level = heading.attrs.level as number;
  const from = pos + heading.nodeSize;
  let to = from;
  let offset = from;
  while (offset < doc.content.size) {
    const child = doc.nodeAt(offset);
    if (!child) break;
    if (child.type.name === "heading" && child.attrs.level <= level) break;
    offset += child.nodeSize;
    to = offset;
  }
  return to > from ? { from, to, level } : null;
}

function buildDecorations(doc: PMNode, state: HeadingsState): DecorationSet {
  if (!state.enabled) return DecorationSet.empty;
  const collapsed = new Set(state.collapsed);
  const decos: Decoration[] = [];
  doc.forEach((node, pos) => {
    if (!isFoldableHeading(node)) return;
    const isCollapsed = collapsed.has(pos);
    const range = hiddenRange(doc, pos);
    // No chevron on a heading with nothing beneath it to fold (e.g. a trailing
    // heading) — unless it's somehow marked collapsed, so it can be re-opened.
    if (!range && !isCollapsed) return;
    // Tag the heading ITSELF (a node decoration), rather than inserting an inline
    // widget at pos+1: an inline widget sat before the heading's first character
    // and stole clicks/selection there (you couldn't click into or select the
    // first letter). With a node decoration nothing is inserted into the inline
    // content, so the first character stays fully selectable. The chevron is
    // painted by CSS (`.ledgr-foldable::before`) in the left gutter; clicks on it
    // are caught by the gutter mousedown handler below (which reads data-fold-pos).
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: "ledgr-foldable" + (isCollapsed ? " is-collapsed" : ""),
        "data-fold-pos": String(pos),
      })
    );
    if (isCollapsed && range) {
      // Hide each whole block in the range (node decorations align to block
      // boundaries, which the range already respects).
      let offset = range.from;
      while (offset < range.to) {
        const child = doc.nodeAt(offset);
        if (!child) break;
        decos.push(
          Decoration.node(offset, offset + child.nodeSize, {
            class: "ledgr-fold-hidden",
          })
        );
        offset += child.nodeSize;
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

// The gutter chevron dispatches this DOM event (bubbles to the editor root); the
// plugin view listens and turns it into a toggle meta. A DOM event keeps the
// gutter mousedown handler decoupled from the toggle/caret-management logic.
const FOLD_TOGGLE_EVENT = "ledgr-fold-toggle";

// The chevron lives in the heading's left gutter (a CSS ::before at negative
// left, so its box sits entirely LEFT of the heading's border box). A click on
// it therefore lands on the heading element with clientX to the left of the
// heading's left edge — the discriminator we use to tell a fold click from a
// click on the heading text. Pixels of gutter we treat as the chevron's hit zone.
const FOLD_GUTTER_HIT_PX = 30;

export const CollapsibleHeadings = Extension.create({
  name: "collapsibleHeadings",
  addProseMirrorPlugins() {
    return [
      new Plugin<HeadingsState>({
        key,
        state: {
          init: () => ({ enabled: false, collapsed: [] }),
          apply(tr, value) {
            let enabled = value.enabled;
            let collapsed = value.collapsed;

            const meta = tr.getMeta(key) as
              | { enabled?: boolean; toggle?: number }
              | undefined;
            if (meta) {
              if (typeof meta.enabled === "boolean") enabled = meta.enabled;
              if (typeof meta.toggle === "number") {
                collapsed = collapsed.includes(meta.toggle)
                  ? collapsed.filter((p) => p !== meta.toggle)
                  : [...collapsed, meta.toggle];
              }
            }

            // Follow edits: remap positions, then keep only those that still
            // point at a foldable heading (dedup so a merge can't double them).
            if (tr.docChanged) {
              const mapped = collapsed
                .map((p) => tr.mapping.map(p, -1))
                .filter((p) => {
                  const n = tr.doc.nodeAt(p);
                  return !!n && isFoldableHeading(n);
                });
              collapsed = [...new Set(mapped)];
            }

            // Auto-expand any collapsed heading whose hidden range the selection
            // now overlaps — so a caret never strands in, and an edit never
            // silently deletes, content the user can't see.
            if (collapsed.length) {
              const sel = tr.selection;
              collapsed = collapsed.filter((p) => {
                const r = hiddenRange(tr.doc, p);
                if (!r) return true;
                return !(sel.from < r.to && sel.to > r.from);
              });
            }

            return { enabled, collapsed };
          },
        },
        props: {
          decorations(state) {
            const s = key.getState(state);
            return s ? buildDecorations(state.doc, s) : null;
          },
        },
        view: (editorView) => {
          // Catch a click on the gutter chevron (the CSS ::before, which paints
          // to the left of the heading box) and turn it into a fold toggle. We
          // key off the click's x being left of the heading's left edge, so a
          // click on the heading text itself is left alone (caret/selection work
          // normally — the whole point of dropping the inline widget). mousedown
          // (not click) so we can preventDefault before the caret moves.
          const gutter = (e: MouseEvent) => {
            const heading = (e.target as HTMLElement | null)?.closest?.(
              "h1.ledgr-foldable, h2.ledgr-foldable, h3.ledgr-foldable"
            ) as HTMLElement | null;
            if (!heading) return;
            const rect = heading.getBoundingClientRect();
            if (e.clientX >= rect.left || e.clientX < rect.left - FOLD_GUTTER_HIT_PX)
              return;
            const attr = heading.getAttribute("data-fold-pos");
            const pos = attr == null ? NaN : Number(attr);
            if (!Number.isFinite(pos)) return;
            e.preventDefault();
            e.stopPropagation();
            heading.dispatchEvent(
              new CustomEvent(FOLD_TOGGLE_EVENT, { detail: { pos }, bubbles: true })
            );
          };
          const handler = (e: Event) => {
            const pos = (e as CustomEvent<{ pos: number }>).detail?.pos;
            if (typeof pos !== "number") return;
            const st = key.getState(editorView.state);
            const tr = editorView.state.tr;
            // When explicitly collapsing, move the caret out of the section
            // first (to the heading) if it sits inside — otherwise the
            // auto-expand guard below would immediately undo this fold. The
            // guard is meant to catch the selection WANDERING into an
            // already-folded region, not to veto a deliberate fold click.
            const willCollapse = !st || !st.collapsed.includes(pos);
            if (willCollapse) {
              const r = hiddenRange(editorView.state.doc, pos);
              const sel = editorView.state.selection;
              if (r && sel.from < r.to && sel.to > r.from) {
                tr.setSelection(
                  TextSelection.create(
                    tr.doc,
                    Math.min(pos + 1, tr.doc.content.size)
                  )
                );
              }
            }
            editorView.dispatch(tr.setMeta(key, { toggle: pos }));
          };
          editorView.dom.addEventListener(FOLD_TOGGLE_EVENT, handler);
          editorView.dom.addEventListener("mousedown", gutter);
          return {
            destroy: () => {
              editorView.dom.removeEventListener(FOLD_TOGGLE_EVENT, handler);
              editorView.dom.removeEventListener("mousedown", gutter);
            },
          };
        },
      }),
    ];
  },
});

// Turn the whole feature on/off (the user's collapsibleHeadingsEnabled setting).
// The host calls this once settings load and whenever the setting changes.
export function setHeadingsCollapsible(editor: Editor, enabled: boolean): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, { enabled }));
}
