// The booth export (Brandon, 2026-07-31): one manuscript, two documents.
//
// Preaching from a manuscript produces two very different reading needs. The
// preacher's copy is colored, annotated, and struck through. The sound booth
// running slides needs the opposite: plain black-and-white prose, no private
// notes, and a cue telling them WHEN to advance the screen.
//
// The marker for "this goes on the screen" is a BLUE HIGHLIGHT (`<mark
// class="hl-blue">`, colors.ts). That choice is deliberate and worth defending:
//   - Background and foreground are ORTHOGONAL marks in the editor and in the
//     markdown, so highlighting a red Scripture span leaves it red. No other
//     channel has that property: reusing a text color would force "on screen"
//     and "is a verse" to compete for the same slot, and only some verses go on
//     the screen.
//   - The editor control, the `hl-*` serializer, the parse side, and the print
//     CSS all already exist. This file adds no syntax and no editor code.
//   - ONE color, not any highlight (Brandon, 2026-07-31): the marker-pen channel
//     keeps its other eight colors free for ordinary highlighting, so marking a
//     slide can never be confused with marking something for yourself.
// Don't re-home this onto a text color or a bespoke syntax without re-reading
// that reasoning.
//
// Every OTHER highlight color is still flattened out of the booth copy — it just
// doesn't become a slide. The booth copy carries no highlights at all; the cue is
// how a slide announces itself there.
//
// ONE pass produces BOTH outputs, because they have to agree: slide N in the
// slides document is the same slide as the `[SLIDE N]` cue in the manuscript.
// Splitting this into two functions would let the numbering drift.
//
// Pure and dependency-free (server + client safe), same posture as
// block-anchor.ts and comment-markdown.ts.
import { highlightColorName, textColorName } from "@/lib/colors";
import { stripComments } from "@/lib/editor/comment-markdown";

// The one highlight color that means "put this on the screen". Every other
// highlight is ordinary highlighting: still flattened out of the booth copy,
// never a slide.
const SLIDE_COLOR = "blue";

// A highlight, per line, with its attributes captured so the color can be read.
// Marks never span lines: Tiptap closes and reopens an inline mark at every block
// boundary and hard break, exactly as it does for comments, so a highlight dragged
// across three paragraphs serializes as three marks (see the bridging block below).
const MARK = /<mark\b([^>]*)>(.*?)<\/mark>/g;
// `class` / `style` out of a captured attribute string, for highlightColorName.
// The serializer writes both (colors.ts), and the class is the primary hook; a
// bare `<mark>` carries neither and so is never the slide color.
const ATTR = (attrs: string, name: string): string | null =>
  attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

function isSlideMark(attrs: string): boolean {
  return (
    highlightColorName(ATTR(attrs, "class"), ATTR(attrs, "style")) ===
    SLIDE_COLOR
  );
}
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
    .replace(STYLED_SPAN, (raw, style: string, inner: string) =>
      textColorName(style) ? inner : raw
    )
    .replace(INS, "$1");
}

// Markdown in → the booth manuscript plus its slide list, numbered in document
// order. Only BLUE highlights are slides (SLIDE_COLOR); other highlight colors
// flatten away like any other formatting. Duplicates are kept on purpose: a sticky
// statement highlighted six times is six trips to the screen, and the booth needs
// a cue for each.
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
    MARK.lastIndex = 0;
    for (let m = MARK.exec(line); m; m = MARK.exec(line)) {
      const [raw, attrs, inner] = m;
      const before = line.slice(last, m.index);
      cued += before;
      gap += before;
      if (isSlideMark(attrs)) {
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
      } else {
        // An ordinary highlight. The mark is unwrapped like any other formatting
        // the booth doesn't need, and its words count as prose — so a highlight in
        // another color sitting between two blue ones BREAKS the bridged run,
        // which is right: that text isn't part of either slide.
        gap += inner;
      }
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
