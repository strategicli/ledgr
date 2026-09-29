// How layout blocks (ADR-284, `::: name` … `:::`) look in the writing surface of
// a page, per Claude Design's "Block Helper Redesign" (2026-09-29): keep the
// structure visible but quiet, and show help only when someone reaches for it.
//
//   - Each block gets a quiet header: a small square, a sentence-case label, and
//     a one-line summary ("Writing · 4 newest · list", "3 columns", "2 parts").
//   - One continuous 2px rail per block at a fixed indent; a nested block adds
//     16px and its header is numbered (1, 2) inside its parent.
//   - The user's highlight color marks only the block the caret is in (its rail,
//     marker, label and a faint wash); everything else stays grey.
//   - Settings lines (collection, topics) read as a key / value grid; a key the
//     block doesn't know turns a fixed amber with "Did you mean … ? Fix".
//   - Icon codes (`:navigation:large:`) show as a small token; the raw text comes
//     back while the caret touches it, so it stays editable as text.
//   - The label (and a "?" on the active block) opens a help card after 400 ms:
//     one sentence, the settings with their values, Insert an example, Docs.
//
// Display only: ProseMirror decorations and widgets, never a schema change, so the
// markdown the editor saves is exactly what was typed (verify-fenced-blocks.mts).
// Fence lines collapse unless the caret is on them, when they show raw.
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { layoutBlocksOn, LAYOUT_BLOCKS_EVENT } from "./slash-suggestion";
import { BLOCK_CARD, BLOCK_HELP, LAYOUT_SNIPPETS } from "@/lib/editor/layout-snippets";
import { ICON_CODE, iconKey } from "@/lib/icon-codes";
import { NAV_ICONS } from "@/lib/nav-icons";
import { openIconPicker } from "./icon-picker";

const key = new PluginKey("layoutBlocksView");

const OPEN = /^\s{0,3}(:{3,})\s*([a-z][a-z0-9-]*)(.*)$/;
const CLOSE = /^\s{0,3}:{3,}\s*$/;
const SETTING_LINE = /^([a-z][a-z0-9-]*)(\s*:\s+)(.+)$/;

type Block = {
  id: number;
  name: string;
  args: string;
  depth: number; // 1 = top level
  parent: number | null;
  childIndex: number; // position among the parent's child blocks, 1-based
  openPos: number;
  openEnd: number;
  closePos: number;
  closeEnd: number;
  childBlocks: number;
  h3: string[];
  headings: string[];
  listItems: number;
  quotes: number;
  firstText: string;
  settings: Record<string, string>;
  badKeys: { key: string; suggestion: string | null; from: number; to: number }[];
};

const labelOf = (name: string) => BLOCK_HELP[name]?.label ?? name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function suggest(bad: string, known: string[]): string | null {
  let best: string | null = null;
  let score = 3;
  for (const k of known) {
    const s = editDistance(bad, k);
    if (s < score) {
      score = s;
      best = k;
    }
  }
  return best;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (t: string, n = 32) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// The one-line summary beside a block's label.
function summaryOf(b: Block): string {
  const quoted = (t: string) => `“${clip(t)}”`;
  switch (b.name) {
    case "collection": {
      const s = b.settings;
      return [s.title ?? s.tag ?? s.type, s.show, s.layout].filter(Boolean).join(" · ") || "all published items";
    }
    case "topics":
      return b.settings.exclude ? `all tags but ${clip(b.settings.exclude, 24)}` : "all tags";
    case "columns":
    case "cards": {
      const n = b.h3.length;
      const noun = b.name === "columns" ? "column" : "card";
      const lead = b.headings.find((h) => !b.h3.includes(h)) ?? b.firstText;
      return [plural(n, noun), lead ? quoted(lead) : ""].filter(Boolean).join(" · ");
    }
    case "row":
      return plural(b.childBlocks, "part");
    case "menu":
      return plural(b.listItems, "link");
    case "timeline":
      return plural(b.listItems, "entry", "entries");
    case "stats":
      return plural(b.listItems, "fact");
    case "quotes":
      return plural(b.quotes, "quote");
    case "hero":
    case "cta":
      return b.headings[0] ? quoted(b.headings[0]) : "";
    case "embed":
      return b.firstText ? clip(b.firstText.replace(/^https?:\/\/(www\.)?/, ""), 28) : "";
    default:
      return b.firstText ? quoted(b.firstText) : "";
  }
}

// Pass 1: find every complete block and gather what its header needs.
function scan(doc: PMNode): Block[] {
  const done: Block[] = [];
  const stack: Block[] = [];
  let seq = 0;
  doc.forEach((node, pos) => {
    const end = pos + node.nodeSize;
    const text = node.isTextblock ? node.textContent : "";
    const top = stack[stack.length - 1];
    if (node.type.name === "paragraph") {
      const open = OPEN.exec(text);
      if (open) {
        if (top) top.childBlocks += 1;
        stack.push({
          id: seq++, name: open[2], args: open[3].trim(), depth: stack.length + 1, parent: top?.id ?? null,
          childIndex: top ? top.childBlocks : 0, openPos: pos, openEnd: end, closePos: -1, closeEnd: -1,
          childBlocks: 0, h3: [], headings: [], listItems: 0, quotes: 0, firstText: "", settings: {}, badKeys: [],
        });
        return;
      }
      if (CLOSE.test(text) && top) {
        top.closePos = pos;
        top.closeEnd = end;
        done.push(stack.pop()!);
        return;
      }
    }
    if (!top) return;
    if (node.type.name === "heading") {
      top.headings.push(node.textContent);
      if (node.attrs.level === 3) top.h3.push(node.textContent);
    } else if (node.type.name === "bulletList" || node.type.name === "orderedList" || node.type.name === "taskList") {
      top.listItems += node.childCount;
    } else if (node.type.name === "blockquote") {
      top.quotes += 1;
    }
    const card = BLOCK_CARD[top.name];
    if (node.type.name === "paragraph" && card?.settings) {
      const known = card.settings.map((s) => s.key);
      let offset = pos + 1;
      for (const line of text.split("\n")) {
        const m = SETTING_LINE.exec(line.trim());
        if (m) {
          const lead = line.length - line.trimStart().length;
          if (known.includes(m[1])) top.settings[m[1]] = m[3].trim();
          else top.badKeys.push({ key: m[1], suggestion: suggest(m[1], known), from: offset + lead, to: offset + lead + m[1].length });
        } else if (!top.firstText && line.trim()) top.firstText = line.trim();
        offset += line.length + 1;
      }
    } else if (!top.firstText && text.trim() && node.type.name === "paragraph") {
      top.firstText = text.trim();
    }
  });
  return done.sort((a, b) => a.openPos - b.openPos);
}

// The rails every node inside a block draws, as CSS custom properties the
// stylesheet paints from a ::before in the indent (one 2px line per level).
function railVars(chain: Block[], active: number | null): string {
  const n = chain.length;
  const layers = chain
    .map((b, i) => {
      const color = b.id === active ? "var(--accent)" : i === 0 ? "var(--lb-rail)" : "var(--lb-rail-nested)";
      return `linear-gradient(${color},${color}) ${i * 16}px 0/2px 100% no-repeat`;
    })
    .join(",");
  return `--lb-indent:${18 + (n - 1) * 16}px;--lb-rails:${layers}`;
}

function svg(iconKeyName: string, size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[iconKeyName as keyof typeof NAV_ICONS]}</svg>`;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// --- the help card --------------------------------------------------------------

let card: HTMLDivElement | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function closeCard() {
  card?.remove();
  card = null;
}

function scheduleClose() {
  if (openTimer) clearTimeout(openTimer);
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(closeCard, 200);
}

function insertExample(editor: Editor, block: Block) {
  const snippet = LAYOUT_SNIPPETS.find((s) => s.id === block.name);
  if (!snippet) return;
  const manager = (editor as unknown as { markdown?: { parse: (md: string) => { content?: unknown[] } } }).markdown;
  const content = manager?.parse(snippet.markdown)?.content;
  const at = Math.min(block.closeEnd, editor.state.doc.content.size);
  editor.chain().focus().insertContentAt(at, (content?.length ? content : snippet.markdown) as never).run();
}

function openCard(anchor: HTMLElement, editor: Editor, block: Block) {
  if (closeTimer) clearTimeout(closeTimer);
  closeCard();
  const info = BLOCK_CARD[block.name];
  const el = document.createElement("div");
  el.className = "lb-help-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `${labelOf(block.name)} help`);
  const rows = info?.settings
    ? `<div class="lb-help-settings">${info.settings
        .map((s) => {
          const current = block.settings[s.key];
          const values = s.values
            ? s.values.map((v) => `<span class="${current && current === v ? "is-current" : ""}">${esc(v)}</span>`).join(" · ")
            : esc(s.desc);
          const extra = s.values ? `<span class="lb-help-desc">${esc(s.desc)}</span>` : current ? `<span class="is-current">${esc(clip(current, 24))}</span>` : "";
          return `<code>${s.key}</code><span>${values}${extra ? ` ${extra}` : ""}</span>`;
        })
        .join("")}</div>`
    : info?.howTo
      ? `<pre class="lb-help-howto">${esc(info.howTo)}</pre>`
      : "";
  const hasExample = LAYOUT_SNIPPETS.some((s) => s.id === block.name);
  el.innerHTML =
    `<div class="lb-help-head"><div class="lb-help-top"><strong>${esc(labelOf(block.name))}</strong><code>::: ${esc(block.name)}</code></div>` +
    `<p>${esc(info?.sentence ?? BLOCK_HELP[block.name]?.hint ?? "A block this page doesn't have a special layout for yet.")}</p></div>` +
    rows +
    `<div class="lb-help-foot">${hasExample ? '<button type="button" data-act="example">Insert an example</button>' : "<span></span>"}` +
    `<a href="/build/guide" target="_blank" rel="noreferrer">Docs ↗</a></div>`;
  el.addEventListener("mouseenter", () => closeTimer && clearTimeout(closeTimer));
  el.addEventListener("mouseleave", scheduleClose);
  el.querySelector('[data-act="example"]')?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closeCard();
    insertExample(editor, block);
  });
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 396))}px`;
  el.style.top = `${r.bottom + 8}px`;
  document.body.appendChild(el);
  card = el;
}

function hoverHelp(target: HTMLElement, editor: Editor, block: Block) {
  target.addEventListener("mouseenter", () => {
    if (closeTimer) clearTimeout(closeTimer);
    if (openTimer) clearTimeout(openTimer);
    openTimer = setTimeout(() => openCard(target, editor, block), 400);
  });
  target.addEventListener("mouseleave", scheduleClose);
}

// --- decorations ----------------------------------------------------------------

function header(editor: Editor, b: Block, chain: Block[], active: number | null, numbered: boolean) {
  const isActive = b.id === active;
  const summary = summaryOf(b);
  const bad = b.badKeys[0];
  return (view: EditorView) => {
    const el = document.createElement("div");
    el.className = `lb-ed-head${isActive ? " is-active" : ""}`;
    el.contentEditable = "false";
    el.setAttribute("style", railVars(chain, active));
    el.innerHTML =
      `${numbered ? `<span class="lb-ed-num">${b.childIndex}</span>` : '<span class="lb-ed-mark"></span>'}` +
      `<span class="lb-ed-label" tabindex="-1">${esc(labelOf(b.name))}</span>` +
      (b.badKeys.length
        ? `<span class="lb-ed-issue">${plural(b.badKeys.length, "setting")} not recognised</span>`
        : summary
          ? `<span class="lb-ed-summary">${esc(summary)}</span>`
          : "") +
      (isActive ? '<span class="lb-ed-q" aria-label="How this block works">?</span>' : "");
    if (bad?.suggestion) {
      const fix = document.createElement("span");
      fix.className = "lb-ed-fix";
      fix.innerHTML = `Did you mean <code>${esc(bad.suggestion)}</code>? <button type="button">Fix</button>`;
      fix.querySelector("button")!.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.dispatch(view.state.tr.insertText(bad.suggestion!, bad.from, bad.to));
      });
      el.appendChild(fix);
    }
    hoverHelp(el.querySelector(".lb-ed-label") as HTMLElement, editor, b);
    const q = el.querySelector(".lb-ed-q") as HTMLElement | null;
    if (q) hoverHelp(q, editor, b);
    // A click on the header puts the caret on the fence line, to edit it raw.
    el.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      editor.chain().focus().setTextSelection(b.openPos + 1).run();
    });
    return el;
  };
}

function iconToken(name: string, size: string | undefined, key: string, from: number, to: number, editor: Editor) {
  return () => {
    const el = document.createElement("span");
    el.className = "lb-ed-token";
    el.contentEditable = "false";
    const sz = size ? ({ small: "S", medium: "M", large: "L", xl: "XL" } as Record<string, string>)[size] ?? `${size}px` : "";
    el.innerHTML = `${svg(key, 11)}<span>${esc(name)}</span>${sz ? `<span class="lb-ed-token-size">· ${sz}</span>` : ""}`;
    el.title = "Click to change this icon or its size";
    // A click reopens the icon picker on this icon, to swap it or resize it.
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      openIconPicker(editor, { replace: { from, to, name: key, size } });
    });
    return el;
  };
}

function build(state: EditorState, editor: Editor): DecorationSet {
  const decos: Decoration[] = [];
  const sel = state.selection;
  const blocks = scan(state.doc);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  // The innermost block holding the caret is the one that lights up.
  const active =
    blocks.filter((b) => sel.from >= b.openPos && sel.from <= b.closeEnd).sort((a, b) => b.depth - a.depth)[0]?.id ?? null;
  const chainOf = (b: Block): Block[] => {
    const out: Block[] = [];
    for (let cur: Block | undefined = b; cur; cur = cur.parent !== null ? byId.get(cur.parent) : undefined) out.unshift(cur);
    return out;
  };

  for (const b of blocks) {
    const chain = chainOf(b);
    const parent = b.parent !== null ? byId.get(b.parent) : undefined;
    const numbered = parent?.name === "row";
    decos.push(
      Decoration.widget(b.openPos, header(editor, b, chain, active, numbered), {
        side: -1,
        key: `lbh-${b.openPos}-${b.id === active}-${summaryOf(b)}-${b.badKeys.map((k) => k.key).join(",")}-${numbered ? b.childIndex : 0}-${chain.length}`,
        ignoreSelection: true,
        stopEvent: () => true,
      })
    );
    const onOpen = sel.from >= b.openPos && sel.from <= b.openEnd;
    const onClose = sel.from >= b.closePos && sel.from <= b.closeEnd;
    decos.push(Decoration.node(b.openPos, b.openEnd, { class: `lb-ed-fence${onOpen ? " lb-ed-raw" : ""}`, style: railVars(chain, active) }));
    decos.push(Decoration.node(b.closePos, b.closeEnd, { class: `lb-ed-fence lb-ed-close${onClose ? " lb-ed-raw" : ""}`, style: railVars(chain, active) }));
    for (const k of b.badKeys) decos.push(Decoration.inline(k.from, k.to, { class: "lb-ed-badkey" }));
  }

  // Every other node inside a block wears the rails of the blocks around it.
  state.doc.forEach((node, pos) => {
    const inside = blocks.filter((b) => pos > b.openPos && pos < b.closePos && !(pos >= b.openPos && pos < b.openEnd));
    if (!inside.length) return;
    if (blocks.some((b) => pos === b.openPos || pos === b.closePos)) return;
    const innermost = inside.sort((a, b) => b.depth - a.depth)[0];
    const chain = chainOf(innermost);
    const card = BLOCK_CARD[innermost.name];
    const settingsPara = node.type.name === "paragraph" && !!card?.settings && node.textContent.split("\n").every((l) => !l.trim() || SETTING_LINE.test(l.trim()));
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `lb-ed-in${innermost.id === active ? " is-active" : ""}${settingsPara ? " lb-ed-settings" : ""}`,
        style: railVars(chain, active),
      })
    );
    if (settingsPara) {
      let offset = pos + 1;
      for (const line of node.textContent.split("\n")) {
        const m = SETTING_LINE.exec(line.trim());
        if (m) {
          const lead = line.length - line.trimStart().length;
          const kFrom = offset + lead;
          decos.push(Decoration.inline(kFrom, kFrom + m[1].length + m[2].length, { class: "lb-ed-key" }));
        }
        offset += line.length + 1;
      }
    }
  });

  // Icon codes anywhere on the page: a small token, raw while the caret touches.
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(ICON_CODE)) {
      const key = iconKey(m[2]);
      if (!key) continue;
      const from = pos + (m.index ?? 0) + m[1].length;
      const to = pos + (m.index ?? 0) + m[0].length;
      if (sel.from >= from && sel.from <= to) {
        decos.push(Decoration.inline(from, to, { class: "lb-ed-code-raw" }));
      } else {
        decos.push(Decoration.inline(from, to, { class: "lb-ed-code-hidden" }));
        decos.push(Decoration.widget(from, iconToken(m[2], m[3], key, from, to, editor), { side: -1, key: `lbi-${from}-${m[0]}`, ignoreSelection: true, stopEvent: () => true }));
      }
    }
  });

  return DecorationSet.create(state.doc, decos);
}

export const LayoutBlocksView = Extension.create({
  name: "layoutBlocksView",
  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            return layoutBlocksOn(editor) ? build(state, editor) : null;
          },
        },
        // Registration happens after mount (the page's control registers its
        // item), so nudge a redraw when it does.
        view(view) {
          const redraw = () => view.dispatch(view.state.tr.setMeta(key, true));
          window.addEventListener(LAYOUT_BLOCKS_EVENT, redraw);
          return {
            destroy: () => {
              window.removeEventListener(LAYOUT_BLOCKS_EVENT, redraw);
              closeCard();
            },
          };
        },
      }),
    ];
  },
});
