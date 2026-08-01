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
// A comment that BRIDGES lines is NOT a wider match — it's one pair per line
// sharing one note (see the grouping block below). Don't widen these to [\s\S]:
// that's the fix this file's earlier ponytail note suggested, and it's the wrong
// one. An anchored range is INLINE, so a single pair spanning a paragraph break
// would have to open a span in one block and close it in another (invalid HTML,
// and impossible for the editor's mark to round-trip), and an unclosed `{>>`
// would once again be free to swallow the document.
const COMMENT =
  /\{==([^\n]*?)==\}[ \t]*\{>>([^\n]*?)<<\}|\{>>([^\n]*?)<<\}/g;

// ---------------------------------------------------------------------------
// BRIDGING: one comment, several lines.
//
// A comment often annotates text that runs past the end of a line — across a
// soft break, a paragraph break, or several list items. The canonical markdown
// for that is one pair PER LINE, all carrying the SAME note, and the identity of
// a comment is its note text: adjacent same-note pairs are ONE comment, shown
// with one margin card and one row in the outline.
//
// Nobody has to type that. The editor produces it on its own, because Tiptap
// closes and reopens an inline mark at every block boundary and hard break, so a
// selection dragged across three paragraphs serializes as three pairs.
//
// "Adjacent" means nothing but whitespace and block scaffolding sits between the
// two pairs — a bullet, a blockquote marker, a heading's #s, a table pipe, the
// trailing backslash of a hard break. Real prose between them is text the comment
// doesn't cover, so the next pair starts a new comment.
//
// ponytail: identity is the note STRING, so two DIFFERENT comments that happen to
// carry byte-identical notes and sit back to back merge into one. Cheaper than
// giving every comment an id the syntax has no room for; if it ever bites, that's
// the upgrade.
const BRIDGE_GAP = /^[\s>#*+\-.\d)|\\]*$/;

// Cheap bail: every claimed form contains "{>>".
function mayHaveComments(markdown: string): boolean {
  return !!markdown && markdown.includes("{>>");
}

// A note as it is safe to WRITE between `{>>` and `<<}`.
//
// The note half is single-line by contract — COMMENT above and the editor's
// tokenizer both match it with [^\n]*?, for the runaway reason stated there. But
// the note is authored in a textarea, and nothing stopped a newline from riding
// the mark's `note` attribute straight into the markdown. That is not a comment
// that merely fails to render, it is UNRECOVERABLE IN PLACE (hit live, Brandon's
// "Don't Worry" manuscript, 2026-08-01):
//
//   1. the pair serializes with a raw newline in it, so nothing can read it back;
//   2. on the next load the run parses as literal text, not a comment mark;
//   3. on the next save @tiptap/markdown encodes that text node's entities, so
//      `{>>…<<}` is rewritten into the body as `{&gt;&gt;…&lt;&lt;}` — no longer
//      even the syntax it started as, on every line the comment bridged.
//
// So the guard belongs on the WRITE side, at every path that puts a note into the
// markdown, and it folds rather than rejects: a note to self should never be
// refused for containing a line break. `<<}` folds for the same reason from the
// other end — it would close the note early and strand the rest as literal text.
export function sanitizeNote(note: string): string {
  return note
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/<<\}/g, "<< }")
    .trim();
}

// Apply `fn` to every line, telling it whether the line is inside (or is a
// delimiter of) a fenced code region. Every caller leaves fenced lines alone; they
// still SEE them because grouping is stateful — a fence sitting between two
// same-note comments has to break the run, and a caller that never hears about
// those lines would silently bridge across it.
//
// ponytail: fence-aware but NOT inline-code-aware, exactly like
// stripBlockAnchors — a literal `{>>x<<}` inside single backticks is rewritten.
// Writing CriticMarkup inside inline code is close to hypothetical; if it ever
// matters, split each line on backtick spans before replacing.
function mapLines(markdown: string, fn: (line: string, inFence: boolean) => string): string {
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
      lines[i] = fn(lines[i], true);
      continue;
    }
    lines[i] = fn(lines[i], inFence);
  }
  return lines.join("\n");
}

// Whether a body carries at least one comment.
export function hasComments(markdown: string): boolean {
  if (!mayHaveComments(markdown)) return false;
  let found = false;
  mapLines(markdown, (line, inFence) => {
    if (inFence) return line;
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
//
// A BRIDGED comment (see BRIDGE_GAP above) underlines every line it covers but
// emits its card ONCE, after the first line: one margin card, one row in the
// outline, one thing to click. The editor places its card the same way.
export function renderComments(markdown: string): string {
  if (!mayHaveComments(markdown)) return markdown;
  // Grouping state, carried across lines: the note of the last pair seen, and the
  // text since it ended. Both reset whenever the run is broken.
  let prevNote: string | null = null;
  let gap = "";
  return mapLines(markdown, (line, inFence) => {
    if (inFence) {
      prevNote = null;
      return line;
    }
    let out = "";
    let last = 0;
    COMMENT.lastIndex = 0;
    for (let m = COMMENT.exec(line); m; m = COMMENT.exec(line)) {
      const [raw, anchored, note, pointNote] = m;
      out += line.slice(last, m.index);
      gap += line.slice(last, m.index);
      if (anchored === undefined) {
        // A point comment anchors no text, so nothing can continue it either way.
        out += `<span class="cmt cmt-point"${noteAttr(pointNote)}></span>${card(pointNote)}`;
        prevNote = null;
      } else {
        const continues = note === prevNote && BRIDGE_GAP.test(gap);
        out += `<span class="cmt"${noteAttr(note)}>${anchored}</span>`;
        if (!continues) out += card(note);
        prevNote = note;
      }
      gap = "";
      last = m.index + raw.length;
    }
    gap += line.slice(last) + "\n";
    return out + line.slice(last);
  });
}

// The note as an ATTRIBUTE, on every span of the comment and on its card. CSS can
// pair one anchor with its card by adjacency, but it cannot reach a segment in
// another block, so a bridged comment lights up (hover) and is gathered (the
// outline's anchor preview) by matching this value instead — comment-hover.ts.
// The editor's mark already renders the identical attribute, so one selector
// serves both surfaces.
//
// Only `&` and `"` need escaping: the value is quoted, and markdown-it's inline
// HTML rule accepts anything but a quote inside a quoted attribute. Reversible, so
// `el.dataset.note` reads back the note verbatim on both surfaces.
function noteAttr(note: string): string {
  return ` data-note="${note.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
}

function card(note: string): string {
  return `<span class="cmt-note"${noteAttr(note)}>${note}</span>`;
}

// Comments → gone, keeping the prose. The anchored text survives (it's the
// author's actual sentence); the markers and the note are dropped. This is what
// print, PDF, share links, and the .docx export run, so a private note to self
// never reaches a reader. Same "the marker never reaches the human-facing render"
// rule as block anchors (ADR-090).
export function stripComments(markdown: string): string {
  if (!mayHaveComments(markdown)) return markdown;
  return mapLines(markdown, (line, inFence) =>
    inFence ? line : line.replace(COMMENT, (_m, anchored) => anchored ?? "")
  );
}
