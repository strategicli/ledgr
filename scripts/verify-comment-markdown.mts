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

// --- render: the two claimed forms ----------------------------------------
check(
  "ranged comment → paired sibling spans",
  renderComments("A {==bad line==}{>>too vague<<} here.") ===
    'A <span class="cmt">bad line</span><span class="cmt-note">too vague</span> here.'
);
check(
  "point comment → empty anchor + note",
  renderComments("Approved.{>>ask Roger<<}") ===
    'Approved.<span class="cmt cmt-point"></span><span class="cmt-note">ask Roger</span>'
);
check(
  "whitespace between the halves is tolerated",
  renderComments("{==x==} {>>y<<}") ===
    '<span class="cmt">x</span><span class="cmt-note">y</span>'
);
check(
  "two comments on one line",
  renderComments("{==a==}{>>1<<} and {==b==}{>>2<<}") ===
    '<span class="cmt">a</span><span class="cmt-note">1</span> and ' +
      '<span class="cmt">b</span><span class="cmt-note">2</span>'
);
check("empty note is still a comment", renderComments("x{>><<}").includes('class="cmt-note"></span>'));

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
    '<span class="cmt">a</span><span class="cmt-note">1</span>\nplain second line'
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
check("text before a fence IS rewritten", fencedRendered.includes('<span class="cmt">a</span>'));
check("text after a fence IS rewritten", fencedRendered.includes('<span class="cmt">c</span>'));
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
check("markdownToHtml renders the anchor span", html.includes('<span class="cmt">hiring timeline</span>'), html);
check("markdownToHtml renders the note span", html.includes('<span class="cmt-note">'));
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

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
