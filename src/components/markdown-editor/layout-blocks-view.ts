// How layout blocks (ADR-284, `::: name` … `:::`) look in the writing surface
// of a page (Tyler, 2026-09-29: "columns, menu, types etc still need to be
// hidden in the surface"; and hover pointers explaining how each block works).
//
// Display only: ProseMirror decorations, never a schema change, so the markdown
// the editor saves is exactly what was typed and the round trip stays byte-safe
// (verify-fenced-blocks.mts). On items registered for layout blocks:
//   - an opening fence line shows as a labeled chip ("Columns") with a hover
//     explanation of how that block works;
//   - a closing fence shows as a thin rule;
//   - lines inside a block get a left edge, so what belongs to it is visible;
//   - `key: value` settings lines (collection, topics) look like form rows.
// When the caret is on a fence line it shows raw again, so it stays editable.
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { layoutBlocksOn, LAYOUT_BLOCKS_EVENT } from "./slash-suggestion";

const key = new PluginKey("layoutBlocksView");

const OPEN = /^\s{0,3}(:{3,})\s*([a-z][a-z0-9-]*)(.*)$/;
const CLOSE = /^\s{0,3}:{3,}\s*$/;
const SETTING = /^[a-z][a-z0-9-]*:\s+\S/;

// The chip label and the hover explanation for each block.
const BLOCKS: Record<string, { label: string; hint: string }> = {
  hero: { label: "Hero", hint: "The opening section. A short line above the heading becomes the eyebrow, the heading is the headline, paragraphs are the lede, a line of links becomes buttons (the first solid), and the first picture is the art." },
  cards: { label: "Cards", hint: "A row of cards. Each ### heading starts a new card. A short line or a ## heading before the first card becomes the section's label and title." },
  columns: { label: "Columns", hint: "Side-by-side points. Each ### heading starts a column (add a fourth ### for four). Start a heading with an icon like :home: to replace the dot." },
  collection: { label: "Collection", hint: "Lists items you've published to this page. Lines inside set it up: title, label, type, tag, show (e.g. 6 newest, 3 oldest) and layout (grid, list, hero or series). It never shows anything you haven't published." },
  topics: { label: "Topics", hint: "Every tag on your published items, with counts. Add 'exclude: featured' to leave tags out. Any other text shows beneath." },
  timeline: { label: "Timeline", hint: "Rows written as - **When** What happened. _a detail_. Good for a history, a résumé or a Now list." },
  stats: { label: "Stats", hint: "Key facts in a row, written as - **Label** value." },
  quotes: { label: "Quotes", hint: "Kind words. Each > quote is one card; end it with a line '— Who said it'." },
  cta: { label: "Call to action", hint: "A closing band: a heading, a line of text, and a line of links that become buttons." },
  callout: { label: "Callout", hint: "A tinted aside for something readers shouldn't miss." },
  embed: { label: "Video or link", hint: "Paste a YouTube or Vimeo link to play it on the page, or any other link to show it as a card. The next line is the caption." },
  row: { label: "Side by side", hint: "Put two blocks inside (with ::: fences, this one uses ::::) to show them next to each other." },
  menu: { label: "Menu", hint: "The site's menu, shown at the top of every page. One line per entry: a link, an @-mention of a published item, a #heading on this page, or plain text." },
  footer: { label: "Footer", hint: "Text for the bottom of every page, beside the 'Shared from' line." },
};
const blockInfo = (name: string) =>
  BLOCKS[name] ?? { label: name.replace(/-/g, " "), hint: "A block this page doesn't have a special layout for yet. Its content still shows as a plain section." };

function build(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  const sel = state.selection;
  const stack: string[] = [];
  state.doc.forEach((node, pos) => {
    const end = pos + node.nodeSize;
    const text = node.isTextblock ? node.textContent : "";
    const caretHere = sel.from <= end && sel.to >= pos;
    const open = node.type.name === "paragraph" ? OPEN.exec(text) : null;
    if (open) {
      const info = blockInfo(open[2]);
      decos.push(
        Decoration.node(pos, end, {
          class: `lb-ed-open${caretHere ? " lb-ed-raw" : ""}`,
          "data-label": info.label,
          "data-hint": info.hint,
          "data-depth": String(stack.length),
        })
      );
      stack.push(open[2]);
      return;
    }
    if (node.type.name === "paragraph" && CLOSE.test(text) && stack.length) {
      stack.pop();
      decos.push(Decoration.node(pos, end, { class: `lb-ed-close${caretHere ? " lb-ed-raw" : ""}` }));
      return;
    }
    if (!stack.length) return;
    const inSettings = (stack[stack.length - 1] === "collection" || stack[stack.length - 1] === "topics") && node.type.name === "paragraph";
    const isSetting = inSettings && text.split("\n").every((l) => SETTING.test(l.trim())) && SETTING.test(text.trim());
    decos.push(
      Decoration.node(pos, end, {
        class: `lb-ed-inner${isSetting ? " lb-ed-setting" : ""}`,
        "data-depth": String(stack.length),
      })
    );
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
            return layoutBlocksOn(editor) ? build(state) : null;
          },
        },
        // Registration happens after mount (the page's control registers its
        // item), so nudge a redraw when it does.
        view(view) {
          const redraw = () => view.dispatch(view.state.tr.setMeta(key, true));
          window.addEventListener(LAYOUT_BLOCKS_EVENT, redraw);
          return { destroy: () => window.removeEventListener(LAYOUT_BLOCKS_EVENT, redraw) };
        },
      }),
    ];
  },
});
