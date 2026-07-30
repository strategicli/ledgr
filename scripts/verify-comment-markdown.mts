// Body-comment verification (ADR-170). Pure — no DB, no env. Covers the
// CriticMarkup parser (renderComments/stripComments/hasComments) and the render
// chain it plugs into: comments visible in the read view, searchable in the FTS
// text, gone from the print/share document.
// Run: npx tsx scripts/verify-comment-markdown.mts
import {
  hasComments,
  renderComments,
  stripComments,
} from "../src/lib/editor/comment-markdown";
import { markdownToHtml, markdownToText } from "../src/lib/markdown-render";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// The shapes renderComments emits. `data-note` is the comment's identity: it's
// what makes several spans one comment (bridging), and what the hover group and
// the outline's anchor preview match on.
const anchor = (text: string, note: string) => `<span class="cmt" data-note="${note}">${text}</span>`;
const cardFor = (note: string) => `<span class="cmt-note" data-note="${note}">${note}</span>`;

// --- render: the two claimed forms ----------------------------------------
check(
  "ranged comment → paired sibling spans",
  renderComments("A {==bad line==}{>>too vague<<} here.") ===
    `A ${anchor("bad line", "too vague")}${cardFor("too vague")} here.`
);
check(
  "point comment → empty anchor + note",
  renderComments("Approved.{>>ask Roger<<}") ===
    'Approved.<span class="cmt cmt-point" data-note="ask Roger"></span>' + cardFor("ask Roger")
);
check(
  "whitespace between the halves is tolerated",
  renderComments("{==x==} {>>y<<}") === anchor("x", "y") + cardFor("y")
);
check(
  "two comments on one line",
  renderComments("{==a==}{>>1<<} and {==b==}{>>2<<}") ===
    `${anchor("a", "1")}${cardFor("1")} and ${anchor("b", "2")}${cardFor("2")}`
);
check(
  "a quote in a note is escaped in the attribute, raw in the card",
  renderComments('{==x==}{>>say "no"<<}') ===
    '<span class="cmt" data-note="say &quot;no&quot;">x</span>' +
      '<span class="cmt-note" data-note="say &quot;no&quot;">say "no"</span>'
);
check(
  "empty note is still a comment",
  renderComments("x{>><<}").includes('class="cmt-note" data-note=""></span>')
);

// --- render: what we deliberately do NOT claim ----------------------------
check(
  "bare {==highlight==} is left literal (not ours; <mark> is)",
  renderComments("{==just a range==}") === "{==just a range==}"
);
check(
  "unclosed {>> is left literal",
  renderComments("a {>>never closed") === "a {>>never closed"
);
check(
  "unopened <<} is left literal",
  renderComments("a note<<} here") === "a note<<} here"
);
check(
  "a note cannot span lines (no runaway match)",
  renderComments("open {>>here\nand closed<<} later") ===
    "open {>>here\nand closed<<} later"
);
check(
  "one line's comment doesn't reach into the next",
  renderComments("{==a==}{>>1<<}\nplain second line") ===
    `${anchor("a", "1")}${cardFor("1")}\nplain second line`
);

// --- bridging: one comment across several lines ----------------------------
// One pair per line sharing one note is ONE comment: every line underlined, a
// single card after the first. This is what the editor serializes for a selection
// dragged across paragraphs (an inline pair can't cross a block boundary), and
// what keeps the margin and the outline from showing the same note three times.
const bridged = renderComments("{==first para==}{>>tighten<<}\n\n{==second para==}{>>tighten<<}");
check(
  "same note on consecutive lines → one card, both anchors",
  bridged === `${anchor("first para", "tighten")}${cardFor("tighten")}\n\n${anchor("second para", "tighten")}`,
  bridged
);
check(
  "bridged comment emits exactly one card",
  bridged.split('class="cmt-note"').length - 1 === 1
);
const bulleted = renderComments("- {==one==}{>>same<<}\n- {==two==}{>>same<<}\n- {==three==}{>>same<<}");
check(
  "a list's bullets are structure, not prose: three items bridge",
  bulleted.split('class="cmt-note"').length - 1 === 1,
  bulleted
);
check(
  "a soft break (trailing backslash) bridges too",
  renderComments("{==one==}{>>same<<}\\\n{==two==}{>>same<<}").split('class="cmt-note"').length - 1 === 1
);
check(
  "different notes stay separate comments",
  renderComments("{==a==}{>>one<<}\n{==b==}{>>two<<}").split('class="cmt-note"').length - 1 === 2
);
check(
  "prose between two same-note comments breaks the run",
  renderComments("{==a==}{>>same<<}\nplain line\n{==b==}{>>same<<}").split('class="cmt-note"')
    .length - 1 === 2
);
check(
  "a fence between two same-note comments breaks the run",
  renderComments("{==a==}{>>same<<}\n```\ncode\n```\n{==b==}{>>same<<}").split('class="cmt-note"')
    .length - 1 === 2
);
check(
  "identical point comments never bridge (nothing anchored to join)",
  renderComments("a{>>same<<}\nb{>>same<<}").split('class="cmt-note"').length - 1 === 2
);
check(
  "strip removes every segment of a bridged comment",
  stripComments("{==first==}{>>tighten<<}\n\n{==second==}{>>tighten<<}") === "first\n\nsecond"
);
check("no {>> at all is returned untouched (fast path)", renderComments("plain **text**") === "plain **text**");
check("track-changes syntax is not claimed", renderComments("{++added++} {--cut--}") === "{++added++} {--cut--}");

// --- render: formatting and mentions survive inside a comment -------------
const rich = renderComments("{==timeline==}{>>ask [@Roger](ledgr://item/abc) about **September**<<}");
check("markdown inside a note is emitted raw, not escaped", rich.includes("**September**"), rich);
check("a mention link inside a note is emitted raw", rich.includes("[@Roger](ledgr://item/abc)"));

// --- strip: the prose survives, the note does not -------------------------
check(
  "strip keeps the anchored text",
  stripComments("A {==bad line==}{>>too vague<<} here.") === "A bad line here."
);
check(
  "strip removes a point comment entirely",
  stripComments("Approved.{>>ask Roger<<}") === "Approved."
);
check(
  "strip leaves non-comment text alone",
  stripComments("Approved. {==unclaimed==}") === "Approved. {==unclaimed==}"
);

// --- fenced code is untouched by both passes ------------------------------
const fenced = ["Before {==a==}{>>1<<}", "```", "code {==b==}{>>2<<}", "```", "After {==c==}{>>3<<}"].join("\n");
const fencedRendered = renderComments(fenced);
check("fence body is not rewritten", fencedRendered.includes("code {==b==}{>>2<<}"), fencedRendered);
check("text before a fence IS rewritten", fencedRendered.includes(anchor("a", "1")));
check("text after a fence IS rewritten", fencedRendered.includes(anchor("c", "3")));
check("strip also skips the fence body", stripComments(fenced).includes("code {==b==}{>>2<<}"));
check("~~~ fences work too", renderComments("~~~\n{==x==}{>>y<<}\n~~~").includes("{==x==}{>>y<<}"));

// --- known ceiling: inline code is NOT protected --------------------------
// Documented, not desired: same limitation as stripBlockAnchors. Asserted so the
// behavior is pinned rather than surprising, and so a future fix has a test to flip.
check(
  "ponytail ceiling: a comment inside single backticks IS rewritten",
  renderComments("write `{>>note<<}` to comment").includes('class="cmt-note"')
);

// --- hasComments ----------------------------------------------------------
check("hasComments: ranged", hasComments("a {==b==}{>>c<<}") === true);
check("hasComments: point", hasComments("a{>>c<<}") === true);
check("hasComments: none", hasComments("plain text") === false);
check("hasComments: unclosed is not a comment", hasComments("a {>>open") === false);
check("hasComments: inside a fence doesn't count", hasComments("```\n{>>x<<}\n```") === false);

// --- the render chain: visible reading, searchable, gone on print --------
const body = "The {==hiring timeline==}{>>too vague, tighten **before** Sunday<<} needs work.";
const html = markdownToHtml(body);
check("markdownToHtml renders the anchor span", html.includes(">hiring timeline</span>"), html);
check("markdownToHtml renders the note span", html.includes('<span class="cmt-note"'));
check("bold inside a note renders as <strong> (markdown-it parses the raw span)", html.includes("<strong>before</strong>"), html);
check("the anchored prose still reads normally", html.includes("needs work."));

const printHtml = markdownToHtml(body, undefined, { comments: false });
check("comments:false drops the note text", !printHtml.includes("too vague"), printHtml);
check("comments:false keeps the anchored prose", printHtml.includes("hiring timeline"));
check("comments:false leaves no stray braces", !printHtml.includes("{==") && !printHtml.includes("{>>"));

const text = markdownToText(body);
check("FTS text includes the comment (searchable)", text.includes("too vague"), text);
check("FTS text includes the anchored prose", text.includes("hiring timeline"));
check("FTS text carries no markup", !text.includes("<span") && !text.includes("{>>"));

// --- the editor's half of bridging (headless ProseMirror doc) --------------
// The markdown says a comment is its note text, so the editor must treat several
// marked runs with one note as ONE range: an edit or a delete has to rewrite all
// of them, not just the block the caret happens to sit in (Tiptap's own
// extendMarkRange stops at the textblock, which is the bug this replaces).
{
  const { getSchema } = await import("@tiptap/core");
  const StarterKit = (await import("@tiptap/starter-kit")).default;
  const { Comment, commentRangeAt } = await import(
    "../src/components/markdown-editor/comment-mark"
  );
  const schema = getSchema([StarterKit, Comment] as never);
  // "tighten" on both paragraphs; positions: para 1 text = 1..11, para 2 = 13..24.
  const para = (text: string, note?: string) => ({
    type: "paragraph",
    content: [
      {
        type: "text",
        text,
        ...(note === undefined ? {} : { marks: [{ type: "comment", attrs: { note } }] }),
      },
    ],
  });
  const docOf = (...content: unknown[]) => schema.nodeFromJSON({ type: "doc", content });

  const both = docOf(para("first para", "tighten"), para("second para", "tighten"));
  check(
    "one note across two paragraphs is ONE range",
    JSON.stringify(commentRangeAt(both, 2)) === JSON.stringify({ from: 1, to: 24 }),
    JSON.stringify(commentRangeAt(both, 2))
  );
  check(
    "the range is the same from either paragraph",
    JSON.stringify(commentRangeAt(both, 15)) === JSON.stringify(commentRangeAt(both, 2))
  );

  const differing = docOf(para("first para", "one"), para("second para", "two"));
  check(
    "different notes stay two ranges",
    JSON.stringify(commentRangeAt(differing, 2)) === JSON.stringify({ from: 1, to: 11 }),
    JSON.stringify(commentRangeAt(differing, 2))
  );

  const interrupted = docOf(
    para("first para", "same"),
    para("plain"),
    para("third para", "same")
  );
  check(
    "an uncommented paragraph between them breaks the run",
    JSON.stringify(commentRangeAt(interrupted, 2)) === JSON.stringify({ from: 1, to: 11 }),
    JSON.stringify(commentRangeAt(interrupted, 2))
  );

  // A soft break inside ONE paragraph: Tiptap closes and reopens the mark around
  // the break, which is why the markdown ends up per-line — and why the run walk
  // has to step over a hardBreak rather than stop at it.
  const soft = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "one", marks: [{ type: "comment", attrs: { note: "n" } }] },
          { type: "hardBreak" },
          { type: "text", text: "two", marks: [{ type: "comment", attrs: { note: "n" } }] },
        ],
      },
    ],
  });
  check(
    "a hard break inside a paragraph does not split the range",
    // "one" 1..4, the break 4..5, "two" 5..8.
    JSON.stringify(commentRangeAt(soft, 2)) === JSON.stringify({ from: 1, to: 8 }),
    JSON.stringify(commentRangeAt(soft, 2))
  );
  check("a position outside every comment has no range", commentRangeAt(differing, 12) === null);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
