// Regression guard for the recursive-escaping bug: flipping a note between the
// rich editor and the source view repeatedly re-escaped markdown inside the
// color/highlight marks (** → \*\* → \\\*\\\* → …), corrupting colored text and
// dropping bold. @tiptap/markdown 3.26 backslash-escapes markdown-significant
// characters in every text node on serialize; that is correct for text emitted
// AS markdown (the parser decodes it) but wrong for the text our color/highlight
// marks emit inside raw inline HTML (<span style=color>/<mark>), which the parse
// side reads back as literal — so the escapes compounded. MarkdownEscapeFix
// (extensions.ts) undoes the escaping for text carrying one of those marks.
//
// This drives the real editor headlessly (linkedom DOM shim). It checks the
// SERIALIZE direction (escaping) AND the PARSE direction: the color/highlight
// marks now reclaim their <span>/<mark> with an inline markdownTokenizer that
// re-tokenizes the inner markdown, so **bold**/*italic*/~~strike~~ inside a
// colored span survive a source⇄rich flip instead of being flattened to literal
// text by @tiptap/markdown's default inline-HTML merge. That parse path is pure
// regex + marked (no DOM span parse), so it runs headlessly here.
// Run: npx tsx scripts/verify-markdown-escape.mts
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
const { TextColor, Highlight, MarkdownEscapeFix, OrderedListTextFix } =
  await import("../src/components/markdown-editor/extensions");
// The palette is the source of truth for the hex a colored span carries. Taken
// from it rather than hardcoded: this test used to spell red "#e03e3e" (the
// BlockNote/Notion red, from before the current palette) which `textColorName`
// does not recognize, so the tokenizer correctly declined the span, it fell
// through to marked's generic inline-HTML path, and the doc came out EMPTY. The
// test had been failing silently because nothing ran it. Deriving the value means
// a future palette change can't re-break it.
const { BLOCKNOTE_COLORS } = await import("../src/lib/colors");
const RED_HEX = BLOCKNOTE_COLORS.red.text;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

function editorFor(withFix: boolean, withOrderedListFix = true) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const exts: unknown[] = [StarterKit, Markdown.configure({ indentation: { style: "space", size: 4 } }), TextColor, Highlight];
  if (withFix) exts.push(MarkdownEscapeFix);
  if (withOrderedListFix) exts.push(OrderedListTextFix);
  return new Editor({ element: el as any, extensions: exts as any, content: "", contentType: "markdown" } as any);
}

// A colored run carrying literal markdown-significant characters. The serializer
// must escape them AND then MarkdownEscapeFix must strip the escapes back off, so
// the stored shape stays the un-escaped raw content the render/export pipeline
// expects.
const marked = (mark: "highlight" | "textColor") => ({
  type: "doc",
  content: [{ type: "paragraph", content: [
    { type: "text", text: "**28** Do not be [anxious]", marks: [{ type: mark, attrs: { color: mark === "highlight" ? "yellow" : "red" } }] },
  ] }],
});

// Without the fix, the bug reproduces: colored text comes out escaped.
const before = editorFor(false);
before.commands.setContent(marked("highlight") as any, { emitUpdate: false } as any);
check("repro: without the fix, colored text IS escaped", /\\\*/.test(before.getMarkdown()));

// With the fix, both marks serialize their content raw (no backslash escapes),
// so re-parsing yields the same doc and re-serializing yields the same string —
// no compounding across flips.
for (const mark of ["highlight", "textColor"] as const) {
  const ed = editorFor(true);
  ed.commands.setContent(marked(mark) as any, { emitUpdate: false } as any);
  const out = ed.getMarkdown();
  check(`${mark}: content not markdown-escaped`, !/\\[*\[\]]/.test(out), out);
  check(`${mark}: ** and [] survive literally`, out.includes("**28**") && out.includes("[anxious]"), out);
}

// Scope guard: the fix must NOT disable escaping for ordinary (unmarked) text,
// where it legitimately prevents a literal * from being read as emphasis.
const plain = editorFor(true);
plain.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "math a*b and _c_" }] }] } as any, { emitUpdate: false } as any);
const plainOut = plain.getMarkdown();
check("plain text still escapes * and _", plainOut.includes("\\*") && plainOut.includes("\\_"), plainOut);

// PARSE direction (the reported bug): formatting inside a colored span must
// survive markdown → doc → markdown. Before the fix, @tiptap/markdown merged the
// span with its inner tokens and re-parsed it as literal HTML, flattening the
// **bold** to a literal "**8**" text node. Now the mark's inline tokenizer
// re-tokenizes the inner markdown, so the bold node survives and round-trips.
function hasBoldTextIn(doc: any, markType: string): boolean {
  const walk = (node: any): boolean => {
    if (node?.type === "text") {
      const marks = (node.marks ?? []).map((m: any) => m.type);
      if (marks.includes("bold") && marks.includes(markType)) return true;
    }
    return (node?.content ?? []).some(walk);
  };
  return walk(doc);
}

for (const [mark, md] of [
  ["textColor", `<span style="color:${RED_HEX}">**8** For by grace</span>`],
  ["highlight", `<mark class="hl-yellow" style="background-color:#fbf3db">**8** For by grace</mark>`],
] as const) {
  const ed = editorFor(true);
  ed.commands.setContent(md, { emitUpdate: false, contentType: "markdown" } as any);
  const doc = ed.getJSON();
  check(`${mark}: bold INSIDE the colored run survives parse`, hasBoldTextIn(doc, mark), JSON.stringify(doc));
  const out = ed.getMarkdown();
  check(`${mark}: bold round-trips back to **8** (not flattened)`, out.includes("**8**"), out);
}

// Regression: inline HTML dialect marks inside an ORDERED list item survive a
// round-trip exactly as they do inside a bullet (Brandon, 2026-08-13 — corrupted
// twice in production: a colored span nested under an ordered sub-list came back
// as literal `&lt;span style="color:…"&gt;` text after saving; the identical span
// one line down, under an UNORDERED sub-list, was untouched). Root cause is
// upstream in @tiptap/extension-list's OrderedList.parseMarkdown, which routes a
// list item's marked "text" token through the generic per-token-type dispatch
// instead of inline-parsing its `.tokens` — landing on @tiptap/extension-text's
// built-in handler, which ignores `.tokens` and returns the raw (HTML-and-all)
// `.text` string. See OrderedListTextFix in extensions.ts for the full trace.
const orderedNested = [
  "- There are two stories in the Gospels where Jesus heals a man who is blind:",
  `    1. In one, a blind man named Bartimaeus calls out from the side of the road, and Jesus heals him with a single sentence: <span style="color:${RED_HEX}">"Go your way; your faith has made you well." (Mark 10:52)</span>`,
  `    2. But in another (<span style="color:${RED_HEX}">John 9</span>), Jesus spits on the ground, makes mud, smears it on the man's eyes, and sends him across town to wash in a pool before he can see anything.`,
].join("\n");
const unorderedNested = [
  "- It's the same with leprosy:",
  `    - One leper he heals instantly, with a touch and a word: <span style="color:${RED_HEX}">"I will; be clean." (Mark 1:41)</span>`,
].join("\n");
const orderedTopLevel = [
  `1. First item with a span: <span style="color:${RED_HEX}">colored text</span>`,
  "2. Second item plain.",
].join("\n");

// Without OrderedListTextFix, the bug reproduces: the span comes back HTML-entity-
// escaped. (Nesting is required to trigger it — see the top-level check below.)
const orderedBefore = editorFor(true, false);
orderedBefore.commands.setContent(orderedNested, { emitUpdate: false, contentType: "markdown" } as any);
check(
  "repro: nested ordered list without the fix DOES escape the span",
  orderedBefore.getMarkdown().includes("&lt;span")
);

// With the fix, the nested ordered list matches the nested bullet list: the span
// (and anything else marked already inline-tokenized) survives unescaped.
const orderedAfter = editorFor(true, true);
orderedAfter.commands.setContent(orderedNested, { emitUpdate: false, contentType: "markdown" } as any);
const orderedOut = orderedAfter.getMarkdown();
check("nested ordered list: span survives, not escaped", !orderedOut.includes("&lt;span"), orderedOut);
check(
  "nested ordered list: span markup round-trips byte-for-byte",
  orderedOut.trim() === orderedNested.trim(),
  orderedOut
);

const unorderedAfter = editorFor(true, true);
unorderedAfter.commands.setContent(unorderedNested, { emitUpdate: false, contentType: "markdown" } as any);
check(
  "contrast: nested unordered list still survives (was never broken)",
  unorderedAfter.getMarkdown().trim() === unorderedNested.trim()
);

// Top-level (unnested) ordered lists take a different upstream code path
// (OrderedList's own tokenizer, not marked's native fallback) and were never
// affected — kept as a sanity check so a future regression there gets caught too.
const topLevelAfter = editorFor(true, true);
topLevelAfter.commands.setContent(orderedTopLevel, { emitUpdate: false, contentType: "markdown" } as any);
check(
  "sanity: top-level ordered list with a span was already fine",
  topLevelAfter.getMarkdown().trim() === orderedTopLevel.trim()
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
