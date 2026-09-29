// Website Pages layout blocks (`::: hero` … `:::`, Pandoc fenced divs) must
// survive the rich editor untouched, because the markdown body is the only
// source of truth (ADR-037/040): if a rich⇄source flip escaped the fence, merged
// it into a paragraph, or dropped it, the page would silently lose its layout.
//
// Drives the real editor headlessly (linkedom DOM shim, the same harness as
// verify-markdown-escape.mts) with the core of the canvas's extension list, and
// checks that each body serializes back byte-identical and stays stable across
// repeated flips.
// Run: npx tsx scripts/verify-fenced-blocks.mts
/* eslint-disable @typescript-eslint/no-explicit-any -- dev-only harness: the
   linkedom DOM shim and Tiptap editor construction need loose typing at the
   library boundary; this script never ships in the app bundle. */
import { parseHTML } from "linkedom";

const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
for (const k of ["window","document","HTMLElement","Node","DocumentFragment","getComputedStyle","Text","Element","MutationObserver"]) {
  try { (globalThis as any)[k] = (window as any)[k] ?? (document as any)[k]; } catch {}
}
try { Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node" }, configurable: true }); } catch {}
(globalThis as any).window = window;
(globalThis as any).document = document;
(globalThis as any).innerHeight = 768;
(globalThis as any).innerWidth = 1024;
(globalThis as any).requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
(globalThis as any).cancelAnimationFrame ??= (id: number) => clearTimeout(id);

const { Editor } = await import("@tiptap/core");
const StarterKit = (await import("@tiptap/starter-kit")).default;
const { Markdown } = await import("@tiptap/markdown");
const { TextColor, Highlight, SlideMark, LedgrImage, MarkdownEscapeFix, EmptyListItemFix, OrderedListTextFix } =
  await import("../src/components/markdown-editor/extensions");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function flip(md: string): string {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el as any,
    extensions: [
      StarterKit.configure({ code: false }),
      Markdown.configure({ indentation: { style: "space", size: 4 } }),
      MarkdownEscapeFix,
      EmptyListItemFix,
      OrderedListTextFix,
      TextColor,
      Highlight,
      SlideMark,
      LedgrImage,
    ] as any,
    content: md,
    contentType: "markdown",
  } as any);
  const out = ed.getMarkdown();
  ed.destroy();
  return out;
}

const CASES: Record<string, string> = {
  "hero, blank lines around fences": [
    "::: hero",
    "",
    "![](/files/abc123)",
    "",
    "# Fall Retreat 2026",
    "",
    "A weekend away to rest and reset.",
    "",
    "[Register now](https://example.com/register)",
    "",
    ":::",
  ].join("\n"),
  "hero, fences tight against content": [
    "::: hero",
    "# Fall Retreat 2026",
    "A weekend away.",
    ":::",
  ].join("\n"),
  "nested carousel > slide": [
    ":::: carousel",
    "",
    "::: slide",
    "",
    "### Friday",
    "",
    "Arrive, dinner, campfire.",
    "",
    ":::",
    "",
    "::: slide",
    "",
    "### Saturday",
    "",
    "Sessions, lake, worship night.",
    "",
    ":::",
    "",
    "::::",
  ].join("\n"),
  "collection section with key: value lines": [
    "::: list",
    "",
    "title: Latest",
    "",
    "source: Devotional",
    "",
    "show: 4 newest",
    "",
    ":::",
  ].join("\n"),
};

// The canonical shape (and what the /section slash command inserts) is a blank
// line around every fence line; that shape round-trips byte-identical. A tight
// hand-typed block is normalized once (the editor opens a blank line after an
// opener that sits on a heading, and a closing fence under a paragraph rides it
// as a soft break) and is stable from then on. Either way every fence stays at
// the start of its own line, which is all the block parser needs.
const TIGHT = new Set(["hero, fences tight against content"]);
const fenceLines = (md: string) => md.split("\n").filter((l) => /^:{3,}/.test(l));

for (const [name, src] of Object.entries(CASES)) {
  const once = flip(src);
  const twice = flip(once);
  if (TIGHT.has(name)) {
    check(`${name}: every fence still starts its own line`, JSON.stringify(fenceLines(once)) === JSON.stringify(fenceLines(src)), JSON.stringify(once));
  } else {
    check(`${name}: one flip is byte-identical`, once === src, JSON.stringify(once));
  }
  check(`${name}: stable across a second flip`, twice === once, JSON.stringify(twice));
  check(`${name}: no fence was escaped`, !/\\:/.test(once), JSON.stringify(once));
}

// --- Part B: the parser, the document strip, and the page render ------------
console.log("\nPart B: parser and renders");
const { parseFencedBlocks, stripFencedBlocks, hasFencedBlocks, readBlockSettings } =
  await import("../src/lib/editor/fenced-blocks");
const { markdownToHtml, markdownToBlockHtml, markdownToText } = await import("../src/lib/markdown-render");

{
  const tree = parseFencedBlocks(CASES["nested carousel > slide"]);
  const top = tree[0] as any;
  check("nested: one top-level carousel", tree.length === 1 && top.kind === "block" && top.name === "carousel");
  check("nested: two slides inside it", top.children.length === 2 && top.children.every((c: any) => c.name === "slide"));
  check("nested: slide keeps its markdown", top.children[0].children[0].text === "### Friday\n\nArrive, dinner, campfire.");
}
{
  const tree = parseFencedBlocks("Intro para.\n\n::: hero dark\n# Title\n:::\n\nOutro.");
  check("mixed: markdown, block, markdown", tree.map((n: any) => n.kind).join(",") === "markdown,block,markdown");
  check("mixed: args captured", (tree[1] as any).args === "dark");
}
{
  const tight = "::: hero\n\n# Fall Retreat 2026\n\nA weekend away.\n:::";
  const tree = parseFencedBlocks(tight);
  check("closer under a paragraph (editor-normalized) still closes", tree.length === 1 && (tree[0] as any).children[0].text.endsWith("A weekend away."));
}
{
  const md = "Before\n\n```\n::: hero\n:::\n```\n\nAfter";
  check("fences inside a code block are not blocks", !hasFencedBlocks(md));
  check("strip leaves code-block fences alone", stripFencedBlocks(md) === md);
}
{
  check("stray ::: typed as text is left alone", stripFencedBlocks("a\n:::\nb") === "a\n:::\nb");
  check("unclosed opener is left alone", stripFencedBlocks("::: hero\ntext") === "::: hero\ntext");
  check("unnamed opener is not a block", !hasFencedBlocks("::: \ntext\n:::"));
}
{
  const { settings, rest } = readBlockSettings("title: Latest\n\nsource: Devotional\nshow: 4 newest\n\nA note.");
  check("settings: key/value lines read", settings.title === "Latest" && settings.source === "Devotional" && settings.show === "4 newest");
  check("settings: other lines kept as content", rest === "A note.");
  check("settings: a bare URL is not a setting", Object.keys(readBlockSettings("https://example.com").settings).length === 0);
}
{
  const body = CASES["hero, blank lines around fences"];
  const doc = markdownToHtml(body, undefined, { comments: false });
  check("document render drops the fence lines", !doc.includes(":::"), doc);
  check("document render keeps the content", doc.includes("Fall Retreat 2026") && doc.includes("Register now"), doc);
  check("search text drops the fence lines", !markdownToText(body).includes(":::"));
  const page = markdownToBlockHtml(body);
  check("page render wraps the block", page.startsWith('<section class="lb lb-hero">') && page.endsWith("</section>"), page);
  const nested = markdownToBlockHtml(CASES["nested carousel > slide"]);
  check("page render nests blocks", /^<section class="lb lb-carousel"><section class="lb lb-slide">/.test(nested), nested);
  const withArgs = markdownToBlockHtml('::: hero "x" <y>\n\nHi\n\n:::');
  check("page render escapes args", withArgs.includes('data-args="&quot;x&quot; &lt;y>"'), withArgs);
  const comment = markdownToBlockHtml("::: hero\n\nHello {>>private note<<}\n\n:::");
  check("page render strips comments", !comment.includes("private note"), comment);
}

// --- Part C: every "/" page-block snippet survives the editor and renders ----
console.log("\nPart C: slash-command snippets");
const { LAYOUT_SNIPPETS } = await import("../src/lib/editor/layout-snippets");
for (const snip of LAYOUT_SNIPPETS) {
  const once = flip(snip.markdown.trimEnd());
  check(`/${snip.id}: fences survive the editor`, JSON.stringify(fenceLines(once)) === JSON.stringify(fenceLines(snip.markdown)), JSON.stringify(once));
  check(`/${snip.id}: parses as one "${snip.id}" block`, (parseFencedBlocks(once)[0] as any)?.name === snip.id, JSON.stringify(once));
}

// --- Part D: block helpers in the writing surface are display-only ----------
console.log("\nPart D: block helpers");
{
  const { LayoutBlocksView } = await import("../src/components/markdown-editor/layout-blocks-view");
  const { setLayoutBlocksFor, setSlashEditorItem } = await import("../src/components/markdown-editor/slash-suggestion");
  const src = [
    "::: columns center", "", "Who I am", "", "### :home:large: Work", "", "Youth pastor.", "", "### Make", "", "Furniture.", "", ":::", "",
    ":::: row", "", "::: collection", "", "title: Writing", "", "tag: writing", "", "show: 4 newest", "", "layot: list", "", ":::", "",
    "::: timeline", "", "## Now", "", "- **Reading** A book. *Again*", "- **Building** A shelf.", "", ":::", "", "::::",
  ].join("\n");
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el as any,
    extensions: [StarterKit.configure({ code: false }), Markdown.configure({ indentation: { style: "space", size: 4 } }), MarkdownEscapeFix, LayoutBlocksView] as any,
    content: src,
    contentType: "markdown",
  } as any);
  const html = () => (ed.view.dom as any).innerHTML as string;
  setSlashEditorItem(ed as any, "page-2");
  ed.view.dispatch(ed.state.tr.setMeta("noop", true));
  check("helpers: none on an item that isn't a page", !html().includes("lb-ed-head"), html());
  setLayoutBlocksFor("page-2", true);
  ed.view.dispatch(ed.state.tr.setMeta("noop", true));
  const h = html();
  check("helpers: a quiet sentence-case label per block", h.includes('<span class="lb-ed-label" tabindex="-1">Columns</span>'), h);
  check("helpers: columns summary counts columns and quotes the label", h.includes("2 columns · “Who I am”"), h);
  check("helpers: row summary counts its parts", h.includes("2 parts"), h);
  check("helpers: timeline summary counts entries", h.includes("2 entries"), h);
  check("helpers: blocks in a row are numbered", /<span class="lb-ed-num">1<\/span><span class="lb-ed-label"[^>]*>Collection/.test(h) && /<span class="lb-ed-num">2<\/span><span class="lb-ed-label"[^>]*>Timeline/.test(h), h);
  check("helpers: nested blocks sit 16px further in", h.includes("--lb-indent:34px"), h);
  check("helpers: an unknown setting is flagged in amber", h.includes("1 setting not recognised") && h.includes("lb-ed-badkey"), h);
  check("helpers: it suggests the right key", h.includes("Did you mean <code>layout</code>?"), h);
  check("helpers: settings read as a key/value grid", h.includes("lb-ed-settings") && h.includes("lb-ed-key"), h);
  check("helpers: icon codes show as a token", h.includes("lb-ed-token") && h.includes("lb-ed-code-hidden") && h.includes("· L</span>"), h);
  check("helpers: the block holding the caret (the first, on load) lights up alone", (h.match(/lb-ed-head is-active/g) ?? []).length === 1, h);
  const inTimeline = ed.state.doc.content.size - 30;
  ed.commands.setTextSelection(inTimeline);
  const h2 = html();
  check("helpers: only the innermost block lights up", (h2.match(/lb-ed-head is-active/g) ?? []).length === 1 && /lb-ed-head is-active[^>]*>(?:(?!<\/div>)[\s\S])*Timeline/.test(h2), h2);
  check("helpers: the saved markdown is untouched", ed.getMarkdown() === src, JSON.stringify(ed.getMarkdown()));
  // Fix the misspelled key through the header's Fix button's own transaction.
  const bad = ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n").indexOf("layot");
  check("helpers: the misspelling is really in the doc", bad >= 0);
  setLayoutBlocksFor("page-2", false);
  ed.destroy();
}

// --- Part E: "/icon" inserts the picked icon's code at the caret -------------
console.log("\nPart E: /icon picker");
{
  const { openIconPicker } = await import("../src/components/markdown-editor/icon-picker");
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el as any,
    extensions: [StarterKit.configure({ code: false }), Markdown.configure({ indentation: { style: "space", size: 4 } }), MarkdownEscapeFix] as any,
    content: "### Home",
    contentType: "markdown",
  } as any);
  (ed.view as any).coordsAtPos = () => ({ left: 10, right: 10, top: 10, bottom: 20 });
  ed.commands.setTextSelection(1); // the start of the heading text, before "Home"
  const press = (node: any) => node.dispatchEvent(new (window as any).Event("mousedown", { bubbles: true, cancelable: true }));
  try {
    openIconPicker(ed as any);
    const popup = document.querySelector(".ledgr-icon-picker") as any;
    check("/icon: the picker opens with the icon grid", !!popup && popup.querySelectorAll(".ledgr-icon-picker-grid button").length > 100);
    press([...popup.querySelectorAll(".ledgr-icon-picker-sizes button")].find((b: any) => b.textContent === "Large"));
    press(popup.querySelector('.ledgr-icon-picker-grid button[aria-label="home"]'));
    check("/icon: picking inserts the code with its size", ed.getMarkdown().startsWith("### :home:large: Home"), JSON.stringify(ed.getMarkdown()));
    check("/icon: the picker closes after a pick", !document.querySelector(".ledgr-icon-picker"));
    // Clicking an icon chip reopens the picker on that code, to swap or resize it.
    const text = ed.state.doc.textContent;
    const from = 1 + text.indexOf(":home:large:");
    openIconPicker(ed as any, { replace: { from, to: from + ":home:large:".length, name: "home", size: "large" }, anchor: { left: 240, bottom: 120 } });
    const again = document.querySelector(".ledgr-icon-picker") as any;
    check("chip: the picker opens under the clicked chip", again?.style.left === "240px" && again?.style.top === "126px", `${again?.style.left} ${again?.style.top}`);
    check("chip: the picker opens on the current icon and size", !!again?.querySelector('.ledgr-icon-picker-grid button.is-current[aria-label="home"]') && [...again.querySelectorAll(".ledgr-icon-picker-sizes button")].some((b: any) => b.textContent === "Large" && b.className === "is-selected"));
    press([...again.querySelectorAll(".ledgr-icon-picker-sizes button")].find((b: any) => b.textContent === "Small"));
    press(again.querySelector('.ledgr-icon-picker-grid button[aria-label="heart"]'));
    check("chip: picking replaces the old code in place", ed.getMarkdown().startsWith("### :heart:small: Home"), JSON.stringify(ed.getMarkdown()));
  } catch (err) {
    check("/icon: headless run", false, String(err));
  }
  ed.destroy();
}

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
