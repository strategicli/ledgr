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

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
