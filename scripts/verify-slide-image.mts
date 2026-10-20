// Regression guard: a slide mark around an image survives a load-then-save.
// <ins class="slide">![alt](/files/<id>)</ins> is a full-screen image slide in the
// presentation player (booth-export.ts, deck.ts), but @tiptap/markdown 3.26 only
// puts marks on TEXT nodes: on parse it skips the image, on serialize it never
// opens a mark that sits on a non-text node. So every save in the editor stripped
// the <ins> wrapper. SlideMark.parseMarkdown and LedgrImage.renderMarkdown
// (extensions.ts) carry the mark across both ends.
// Run: npx tsx scripts/verify-slide-image.mts
/* eslint-disable @typescript-eslint/no-explicit-any -- dev-only harness: the
   linkedom DOM shim and Tiptap editor construction need loose typing. */
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
const { SlideMark, LedgrImage, MarkdownEscapeFix } = await import(
  "../src/components/markdown-editor/extensions"
);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

function editorWith(md: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el as any,
    extensions: [StarterKit, Markdown, SlideMark, LedgrImage, MarkdownEscapeFix] as any,
    content: md,
    contentType: "markdown",
  } as any);
}

const SLIDE_IMG = '<ins class="slide">![x](/files/abc)</ins>';
const out = editorWith(SLIDE_IMG).getMarkdown().trim();
check("image slide mark round-trips unchanged", out === SLIDE_IMG, out);

const TEXT = '<ins class="slide">Some **words**</ins>';
const textOut = editorWith(TEXT).getMarkdown().trim();
check("text slide mark still round-trips", textOut === TEXT, textOut);

const plain = editorWith("![x](/files/abc)").getMarkdown().trim();
check("plain image gains no slide mark", plain === "![x](/files/abc)", plain);

// The toolbar's slide button: select the image (a node selection, as a click
// does) and toggle the mark. The image follows a word so it parses inside a
// paragraph; a bare image line in this stripped-down harness lands at the doc root.
const ed = editorWith("See ![x](/files/abc)");
let imgPos = -1;
ed.state.doc.descendants((n: any, pos: number) => { if (n.type.name === "image") imgPos = pos; });
ed.commands.setNodeSelection(imgPos);
ed.commands.toggleMark("slide");
const toggled = ed.getMarkdown().trim();
check("toggling slide on a selected image adds the mark", toggled === `See ${SLIDE_IMG}`, toggled);
check("toolbar sees the selected image as a slide", ed.isActive("slide"));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
