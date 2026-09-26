// Editor-side comment round-trip (ADR-170): a comment applied across a line that
// holds bold, inline code, or a mention chip saves as ONE CriticMarkup pair; a
// comment across lines saves one readable pair per line and reads back as ONE
// comment (one card) in both the editor and the read view. Headless Tiptap on
// linkedom, no DB, no env.
// Run: npx tsx scripts/verify-comment-editor.mts
import { parseHTML } from "linkedom";
const { window } = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window, document: window.document });

const { Editor } = await import("@tiptap/core");
const StarterKit = (await import("@tiptap/starter-kit")).default;
const { Markdown } = await import("@tiptap/markdown");
const { TaskList, TaskItem } = await import("@tiptap/extension-list");
const { Comment, CommentCards, CommentableCode, commentRangeAt, setComment } = await import(
  "../src/components/markdown-editor/comment-mark"
);
const { Highlight, LedgrMention, MarkdownEscapeFix, SlideMark, TextColor } = await import(
  "../src/components/markdown-editor/extensions"
);
const { renderComments } = await import("../src/lib/editor/comment-markdown");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// Same order as MarkdownEditor: the manager patches rely on it.
const editor = new Editor({
  element: null,
  extensions: [
    StarterKit.configure({ code: false }),
    Markdown,
    MarkdownEscapeFix,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextColor,
    Highlight,
    SlideMark,
    Comment,
    CommentCards,
    CommentableCode,
    LedgrMention,
  ],
});

const cards = (md: string) => (renderComments(md).match(/class="cmt-note"/g) ?? []).length;
const pairs = (md: string) => (md.match(/\{==/g) ?? []).length;

// Select everything, optionally add a mark first, comment it, and report.
function commentAll(md: string, before?: (e: typeof editor) => void) {
  editor.commands.setContent(md, { contentType: "markdown" });
  editor.commands.selectAll();
  before?.(editor);
  setComment(editor, "n");
  const out = editor.getMarkdown();
  // Reload what was saved: it must parse back to the same thing, and the editor
  // must see one comment spanning the whole doc.
  editor.commands.setContent(out, { contentType: "markdown" });
  const again = editor.getMarkdown();
  // Every commented position, first to last, must fall in the run found at the first.
  const at: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.marks.some((m) => m.type.name === "comment")) at.push(pos, pos + node.nodeSize);
  });
  const run = at.length ? commentRangeAt(editor.state.doc, at[0]) : null;
  return {
    out,
    stable: again === out,
    oneRun: !!run && run.from <= at[0] && run.to >= at[at.length - 1],
  };
}

const MENTION = "[@Roger](ledgr://item/00000000-0000-0000-0000-000000000001)";

// --- one line, several inline kinds: ONE pair ------------------------------
for (const [name, md] of [
  ["bold + inline code (the /setup line)", "**A** `/setup` **page** that inspects config."],
  ["italic + bold", "*it* and **bold** here"],
  ["mention chip in the middle", `see ${MENTION} about it`],
  ["chip at the start", `${MENTION} said so`],
] as const) {
  const r = commentAll(md);
  check(`${name}: one pair`, pairs(r.out) === 1, r.out);
  check(`${name}: one card`, cards(r.out) === 1);
  check(`${name}: reload is stable`, r.stable);
  check(`${name}: editor sees one comment`, r.oneRun);
}
check(
  "inline code keeps its backticks inside the pair",
  commentAll("a `b` c").out === "{==a `b` c==}{>>n<<}"
);

// --- across lines: one pair per line, one comment --------------------------
for (const [name, md, before] of [
  ["two paragraphs", "para one **b**\n\npara two", undefined],
  ["soft break inside one paragraph", "line one\nline two", undefined],
  ["bullets with code", "- one\n- `two` x\n- three", undefined],
  ["task list", "- [ ] one\n- [ ] two", undefined],
  ["highlighted lines", "first line\n\nsecond line", (e: typeof editor) => e.commands.setMark("highlight")],
  ["italic then strike", "*first*\n\n~~second~~", undefined],
  ["block anchors at line ends", "do one ^abc123\n\ndo two ^def456", undefined],
] as const) {
  const r = commentAll(md, before);
  check(`${name}: every pair is single-line`, !/\{==[^\n]*\n/.test(r.out.replace(/\{==[^\n]*?==\}\{>>[^\n]*?<<\}/g, "")), r.out);
  check(`${name}: one card`, cards(r.out) === 1, r.out);
  check(`${name}: reload is stable`, r.stable);
  check(`${name}: editor sees one comment`, r.oneRun);
}
const anchored = commentAll("do one ^abc123\n\ndo two ^def456").out;
check(
  "a trailing block anchor stays outside the pair",
  anchored === "{==do one==}{>>n<<} ^abc123\n\n{==do two==}{>>n<<} ^def456",
  anchored
);

// Point comments (speaker notes) are styled in place by decorations and never
// rewritten: each gets its box + label + two faded delimiters, positions land on
// the delimiters even after a mention chip, and code is left alone.
const { pointNoteDecorations } = await import("../src/components/markdown-editor/comment-mark");
{
  const md =
    "Slide text\n\n{>>speaker note<<}\n\nSee [@Roger](ledgr://item/00000000-0000-0000-0000-000000000001) {>>after a chip<<}\n\n`{>>in code<<}`\n\n```\n{>>in a fence<<}\n```";
  editor.commands.setContent(md, { contentType: "markdown" });
  const doc = editor.state.doc;
  const found = pointNoteDecorations(doc).find();
  const boxes = found.filter((d) => (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class === "cmt-point-edit");
  const texts = boxes.map((d) => doc.textBetween(d.from, d.to));
  check("two notes styled, code skipped", texts.length === 2, JSON.stringify(texts));
  check("note ranges cover the delimiters exactly", texts[0] === "{>>speaker note<<}" && texts[1] === "{>>after a chip<<}", JSON.stringify(texts));
  check("one label widget per note", found.length === boxes.length * 4, String(found.length));
  check("styling leaves the markdown untouched", editor.getMarkdown() === md, editor.getMarkdown());
}

editor.destroy();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
