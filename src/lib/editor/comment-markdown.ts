// Comments on the body (ADR-170). A comment is a note to self anchored to a
// span of the body's own text, written in CriticMarkup:
//
//   ranged: This is a {==line with a comment==}{>>too vague, tighten this<<}.
//   point:  Budget is approved.{>>confirm with Roger first<<}
//
// The comment lives IN the canonical markdown, which is the whole point:
//  - the anchor IS the text it points at, so a comment cannot drift or orphan
//    the way a side table keyed to a line anchor would (restoreRevision would
//    silently strand every row);
//  - revisions, the weekly backup, and the OneDrive export cover comments for
//    free, with no new table and no migration;
//  - CriticMarkup is an established syntax (iA Writer, Marked 2, Ulysses,
//    Obsidian plugins), so the exported .md degrades legibly in any other
//    editor instead of losing the note.
//
// Only the two forms above are claimed. CriticMarkup's track-changes trio
// ({++ins++}, {--del--}, {~~a~>b~~}) is deliberately NOT implemented: it exists
// for collaborative redlining, and Ledgr's comments are non-conversational notes
// to self (ADR-170). A bare {==highlight==} with no comment after it is also not
// ours — Ledgr highlights are <mark> (colors.ts) — so it's left as literal text.
//
// Pure and dependency-free (server + client safe), same posture as
// block-anchor.ts. renderComments/stripComments are the two ends the render
// chain in markdown-render.ts picks between.

// Fence detection, matching block-anchor.ts so both passes agree on what counts
// as code.
const FENCE = /^ *(`{3,}|~{3,})/;

// The pair first, then a standalone note. Both halves are single-line by
// design: a comment is a short note, and keeping the match inside one line means
// an unclosed `{>>` can never run away and swallow the rest of the document.
//
// ponytail: single-line only; if an anchored range ever needs to span a soft line
// break, widen these to [\s\S] and bound the match to a paragraph.
const COMMENT =
  /\{==([^\n]*?)==\}[ \t]*\{>>([^\n]*?)<<\}|\{>>([^\n]*?)<<\}/g;

// Cheap bail: every claimed form contains "{>>".
function mayHaveComments(markdown: string): boolean {
  return !!markdown && markdown.includes("{>>");
}

// Apply `fn` to every line outside a fenced code region.
//
// ponytail: fence-aware but NOT inline-code-aware, exactly like
// stripBlockAnchors — a literal `{>>x<<}` inside single backticks is rewritten.
// Writing CriticMarkup inside inline code is close to hypothetical; if it ever
// matters, split each line on backtick spans before replacing.
function mapOutsideFences(markdown: string, fn: (line: string) => string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceChar = "";
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]);
    if (fence) {
      const char = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (!inFence) lines[i] = fn(lines[i]);
  }
  return lines.join("\n");
}

// Whether a body carries at least one comment.
export function hasComments(markdown: string): boolean {
  if (!mayHaveComments(markdown)) return false;
  let found = false;
  mapOutsideFences(markdown, (line) => {
    COMMENT.lastIndex = 0;
    if (COMMENT.test(line)) found = true;
    return line;
  });
  return found;
}

// Comments → the read-view markup: the anchored text in a `.cmt` span, the note
// in a sibling `.cmt-note` span right after it. A point comment gets an empty
// `.cmt.cmt-point` span so it still has something to hang a pin on.
//
// The two spans are ADJACENT SIBLINGS on purpose: that's what lets the stylesheet
// pair them (`.cmt:has(+ .cmt-note:hover)`) and the mobile tap handler find the
// note with nextElementSibling, so neither needs an id, a counter, or any state.
//
// Both the anchored text and the note are emitted RAW, not escaped, so
// markdown-it still parses the markdown inside them: **bold**, links, and native
// [@Title](ledgr://item/<id>) mention chips all work inside a comment with no
// extra code, and the mention core rule rewrites them normally. That's the same
// trust basis as the rest of the body (markdown-render.ts runs html:true for a
// single trusted author rendering their own content).
export function renderComments(markdown: string): string {
  if (!mayHaveComments(markdown)) return markdown;
  return mapOutsideFences(markdown, (line) =>
    line.replace(COMMENT, (_m, anchored, note, pointNote) =>
      anchored === undefined
        ? `<span class="cmt cmt-point"></span><span class="cmt-note">${pointNote}</span>`
        : `<span class="cmt">${anchored}</span><span class="cmt-note">${note}</span>`
    )
  );
}

// Comments → gone, keeping the prose. The anchored text survives (it's the
// author's actual sentence); the markers and the note are dropped. This is what
// print, PDF, share links, and the .docx export run, so a private note to self
// never reaches a reader. Same "the marker never reaches the human-facing render"
// rule as block anchors (ADR-090).
export function stripComments(markdown: string): string {
  if (!mayHaveComments(markdown)) return markdown;
  return mapOutsideFences(markdown, (line) =>
    line.replace(COMMENT, (_m, anchored) => anchored ?? "")
  );
}
