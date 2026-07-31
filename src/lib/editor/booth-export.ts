// The booth export (Brandon, 2026-07-31): one manuscript, two documents.
//
// Preaching from a manuscript produces two very different reading needs. The
// preacher's copy is colored, annotated, and struck through. The sound booth
// running slides needs the opposite: plain black-and-white prose, no private
// notes, and a cue telling them WHEN to advance the screen.
//
// The marker for "this goes on the screen" is the SLIDE MARK, `<ins class="slide">`
// (the toolbar's screen button, left of the comment bubble; extensions.ts owns the
// round-trip). That choice is deliberate and worth defending:
//   - It is its OWN channel. A comment owns the underline channel and a highlight
//     owns the fill channel, and a slide routinely sits on the same words as
//     either, so it gets a third: a rule bracketing each end of the span.
//   - The signal is therefore a SHAPE, not a color, which is what lets it read on
//     top of all five text colors a manuscript uses. This replaced a blue
//     highlight, which was the first build and which Brandon rejected in practice
//     (2026-07-31): a blue wash under red Scripture was painful to read, and a
//     blue rule under blue insight text was invisible.
//   - A text color could never have worked: only SOME verses go on the screen, so
//     "on screen" and "is a verse" must not compete for one slot.
// Don't re-home this onto a color, a highlight, or a bespoke syntax without
// re-reading that reasoning.
//
// Highlights are now ordinary highlighting again, in all nine colors, and are
// flattened out of the booth copy like any other formatting it doesn't need.
//
// ONE pass produces BOTH outputs, because they have to agree: slide N in the
// slides document is the same slide as the `[SLIDE N]` cue in the manuscript.
// Splitting this into two functions would let the numbering drift.
//
// Pure and dependency-free (server + client safe), same posture as
// block-anchor.ts and comment-markdown.ts.
import { textColorName } from "@/lib/colors";
import { stripComments } from "@/lib/editor/comment-markdown";

// A slide mark, per line. Marks never span lines: Tiptap closes and reopens an
// inline mark at every block boundary and hard break, exactly as it does for
// comments, so a slide dragged across three paragraphs serializes as three marks
// (see the bridging block below).
//
// `<ins>` rather than a span is what makes this regex safe: a slide almost always
// wraps a colored span, and matching `<span class="slide">…</span>` non-greedily
// would close on the INNER `</span>`. See the SlideMark comment in extensions.ts.
const SLIDE = /<ins\b[^>]*\bclass\s*=\s*"[^"]*\bslide\b[^"]*"[^>]*>(.*?)<\/ins>/g;
// Highlight markup, unwrapped in the booth copy: the words stay, the marker pen
// doesn't. Nine colors, all ordinary highlighting now that the slide mark is its
// own channel.
const HIGHLIGHT = /<\/?mark\b[^>]*>/g;
// A styled span. Only a recognized palette color is ours to unwrap — a span
// carrying anything else (a mention's markup, a stray paste) is left alone.
const STYLED_SPAN = /<span style="([^"]*)">(.*?)<\/span>/g;
// Struck-through text is material the preacher CUT. It leaves the booth copy
// entirely, content and all — unlike every other transform here, which keeps
// the words and drops only the markup.
const STRIKE = /~~(.*?)~~/g;
// `++text++` is what the editor's underline mark serializes to. markdown-it has
// no rule for it, so it renders as literal plus signs; the booth copy unwraps it
// to plain text. (markdown-render.ts renders it as <u> for every other surface.)
const INS = /\+\+(.*?)\+\+/g;
const FENCE = /^ *(`{3,}|~{3,})/;

// Nothing but whitespace and block scaffolding — a bullet, a blockquote marker, a
// heading's #s, a table pipe, a hard break's trailing backslash. Same idea (and
// same character class) as comment-markdown's BRIDGE_GAP, for the same reason.
const SCAFFOLD_ONLY = /^[\s>#*+\-.\d)|\\]*$/;

export type Slide = { n: number; text: string };
export type BoothExport = { manuscript: string; slides: Slide[] };

// Every transform that turns preacher-facing markup into booth-facing prose.
// Shared by the manuscript and the slide text so the two can never disagree
// about what a given span says.
//
// ponytail: non-greedy single-pass replaces, so NESTED same-kind markup (a color
// span inside a color span) mis-pairs. The editor never emits that — a mark
// doesn't nest inside itself — so this is only reachable by hand-written HTML in
// the body. Upgrade path if it ever bites: a real inline parser.
function flatten(md: string): string {
  return stripComments(md)
    .replace(STRIKE, "")
    .replace(HIGHLIGHT, "")
    .replace(STYLED_SPAN, (raw, style: string, inner: string) =>
      textColorName(style) ? inner : raw
    )
    .replace(INS, "$1");
}

// Markdown in → the booth manuscript plus its slide list, numbered in document
// order. Duplicates are kept on purpose: a sticky statement marked six times is six
// trips to the screen, and the booth needs a cue for each.
export function boothExport(markdown: string): BoothExport {
  const slides: Slide[] = [];
  if (!markdown) return { manuscript: "", slides };

  const out: string[] = [];
  // Bridging state, carried across lines. `gap` is the text since the last
  // highlight ended; if nothing but scaffolding sits in it, the next highlight
  // CONTINUES the same slide rather than starting a new one. `seen` keeps the
  // very first highlight of the document from continuing nothing.
  let seen = false;
  let gap = "";
  let inFence = false;
  let fenceChar = "";

  for (const line of markdown.split("\n")) {
    const fence = FENCE.exec(line);
    if (fence) {
      const char = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      // A fence breaks any run: a highlight before it and one after it are two
      // slides, not one bridged slide.
      seen = false;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    let cued = "";
    let last = 0;
    SLIDE.lastIndex = 0;
    for (let m = SLIDE.exec(line); m; m = SLIDE.exec(line)) {
      const [raw, inner] = m;
      const before = line.slice(last, m.index);
      cued += before;
      gap += before;
      const text = flatten(inner).trim();
      const continues = seen && SCAFFOLD_ONLY.test(gap);
      if (continues && slides.length > 0) {
        // Same slide, another line of it: one cue, one slide, several lines.
        slides[slides.length - 1].text += "\n" + text;
      } else {
        slides.push({ n: slides.length + 1, text });
        cued += `**[SLIDE ${slides.length}]** `;
      }
      seen = true;
      gap = "";
      cued += inner;
      last = m.index + raw.length;
    }
    const tail = line.slice(last);
    gap += tail + "\n";
    cued += tail;

    const flat = flatten(cued);
    // A line whose only content was struck through is gone, not left as an empty
    // bullet. Guarded so an untouched line (an `---` rule, a bare list marker the
    // author typed) is never dropped: something has to have been REMOVED, and the
    // line has to have held words before and hold none now.
    if (flat !== cued && /\w/.test(cued) && !/\w/.test(flat)) continue;
    out.push(flat);
  }

  return { manuscript: out.join("\n"), slides };
}

// The slides document body: one numbered section per slide, in the order the
// booth will need them. Markdown (not plain text) so bold survives the trip and
// the note prints legibly; the booth's own copy-paste target decides the rest.
export function slidesMarkdown(slides: Slide[]): string {
  return slides.map((s) => `## Slide ${s.n}\n\n${s.text}`).join("\n\n");
}
