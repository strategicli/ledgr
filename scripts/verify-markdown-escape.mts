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
// This drives the real editor headlessly (linkedom DOM shim) and checks the
// SERIALIZE direction, where the bug originates and the fix lives. The HTML-mark
// PARSE direction can't run under linkedom (it drops <mark>), so it's covered by
// the in-browser check on the real canvas.
// Run: npx tsx scripts/verify-markdown-escape.mts
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
const { TextColor, Highlight, MarkdownEscapeFix } =
  await import("../src/components/markdown-editor/extensions");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

function editorFor(withFix: boolean) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const exts: unknown[] = [StarterKit, Markdown.configure({ indentation: { style: "space", size: 4 } }), TextColor, Highlight];
  if (withFix) exts.push(MarkdownEscapeFix);
  return new Editor({ element: el as any, extensions: exts as any, content: "", contentType: "markdown" } as any);
}

// The doc state the HTML-mark parse always yields: literal "**28**" text carrying
// the mark (bold flattened by the raw-HTML round-trip). This is the fixed point
// each rich⇄source flip round-trips on.
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

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
