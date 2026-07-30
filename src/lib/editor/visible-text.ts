// Markdown → the text a reader actually sees, for the canvas word count.
//
// The rule (Brandon, 2026-07-30): count what the author wrote and the reader
// reads; hide everything that only makes it look that way. So link and image
// destinations, inline HTML, comment notes, tokens, and list/footnote markers
// come out, while every word the author typed stays — link labels, mention
// labels, headings, table cells, a comment's anchored sentence, and CODE.
//
// Code counts on purpose: a fenced block is text the author deliberately wrote
// and can see, and it may well hold prose. Only its scaffolding goes (the ```
// delimiters and the language tag). Code is also held OUT of the markup passes,
// so a `<div>`, a URL, or a `[a](b)` written inside a code block is counted as
// the literal words the reader sees rather than mistaken for markup.
//
// WHY A REGEX PASS AND NOT THE REAL PARSER: markdownToText (markdown-render.ts)
// already does this properly by rendering with markdown-it and stripping tags,
// and it stays the right tool for the FTS document. But markdown-render.ts is
// deliberately server-only — "never imported by a client component, so the
// editor bundle never pays for it" — and the word count reruns on the client as
// you type. So this module is pure, dependency-free, and client-safe, the same
// posture as block-anchor.ts and comment-markdown.ts. Don't "simplify" it by
// importing markdown-render.ts: that pulls markdown-it into the editor bundle.
//
// It is approximate BY DESIGN. A word count is a rough gauge, not a contract:
// erring toward under-counting markup beats inflating a sermon's length with
// URLs and CSS class names.
import { stripBlockAnchors } from "@/lib/editor/block-anchor";
import { stripComments } from "@/lib/editor/comment-markdown";

// Fence detection, matching block-anchor.ts / comment-markdown.ts so all the
// passes agree on what counts as code.
const FENCE = /^ *(`{3,}|~{3,})/;

// An inline code span, longest-fence-first so ``a `b` c`` closes correctly.
const INLINE_CODE = /(`+)([^`\n]*?)\1/g;

// An HTML tag: a real tag name right after "<" (so prose like "5 < 10" and
// "a < b and b > c" is left alone), attributes bounded to one line so an
// unclosed "<" can't swallow the document. HTML comments go whole — that
// silently covers canvas tab markers (`<!-- tab: Title -->`, ADR-095), whose
// titles are canvas chrome rather than body text.
const HTML_TAG = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>\n]*)?\/?>/g;

// `![alt](src "title")`. An image contributes nothing a reader reads, so alt and
// title leave with the src. Runs BEFORE the link rule, or the "!" would strand
// the alt text as words.
const IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;

// `[label](dest "title")` → the label. This is where mention chips shed their
// ledgr://item/<uuid> (five phantom words each, the single biggest inflator in
// a body full of @-mentions) and ordinary links shed their URLs.
const INLINE_LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;

// A Pandoc footnote marker, `[^1]` in the text and `[^1]:` opening the note. The
// marker goes; the note's own text is prose and stays.
const FOOTNOTE_MARKER = /\[\^[^\]\n]+\]/g;

// A bare URL left in the text (an autolink's <>, a reference-link definition, or
// a pasted link). Whatever wrapper it sat in has no word characters of its own.
const BARE_URL = /(?:https?|ftp|mailto|ledgr):(?:\/\/)?[^\s<>()"']+/gi;

// A live item token, {{item.title}} / {{now.today}} (ADR-139). Its resolved
// value IS text the reader sees, but only the server can resolve it, so the
// token counts as nothing rather than counting its own internals ("item",
// "title") as words.
const ITEM_TOKEN = /\{\{[^}\n]*\}\}/g;

// A leading list marker plus an optional task checkbox. Bullets carry no word
// characters, but "1." and "[x]" both do — an ordered list used to add one
// phantom word per item, a task list one per checked box.
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/gm;

// A named or numeric HTML entity: renders as punctuation or a space, never a
// word ("&nbsp;" was counting as "nbsp").
const ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g;

// Split a body into the part the markup rules apply to and the code text they
// must not touch. Fence delimiters (and their language tag) are dropped as
// scaffolding; the lines between them, and the inside of every inline span, are
// kept verbatim as authored words.
//
// ponytail: fenced blocks only — a 4-space indented code block goes down the
// markup path, because telling one apart from an indented list continuation
// needs the real parser, and the editor emits fences.
function splitCode(markdown: string): { text: string; code: string } {
  const text: string[] = [];
  const code: string[] = [];
  let fenceChar = "";
  for (const line of markdown.split("\n")) {
    const fence = FENCE.exec(line);
    if (fence) {
      const char = fence[1][0];
      if (!fenceChar) fenceChar = char;
      else if (char === fenceChar) fenceChar = "";
      continue;
    }
    if (fenceChar) {
      code.push(line);
      continue;
    }
    // An inline span leaves a space behind so "a`x`b" stays two words, and its
    // contents join the code pile untouched.
    text.push(
      line.replace(INLINE_CODE, (_m, _ticks, inner: string) => {
        code.push(inner);
        return " ";
      })
    );
  }
  return { text: text.join("\n"), code: code.join("\n") };
}

// Markdown → the visible text, markup gone and code intact. Markup becomes a
// space rather than nothing, so "one<br>two" stays two words.
//
// The code text is appended rather than spliced back in place: the only caller
// counts words, and word counting doesn't care about order — splicing would buy
// nothing but a placeholder scheme to get wrong.
//
// Order is load-bearing: the two fence-aware passes (comments, block anchors)
// run while the fences are still there, and images run before links.
export function visibleTextOf(markdown: string): string {
  if (!markdown) return "";
  const { text, code } = splitCode(stripBlockAnchors(stripComments(markdown)));
  const prose = text
    .replace(HTML_TAG, " ")
    .replace(IMAGE, " ")
    .replace(INLINE_LINK, "$1")
    .replace(FOOTNOTE_MARKER, " ")
    .replace(BARE_URL, " ")
    .replace(ITEM_TOKEN, " ")
    .replace(LIST_MARKER, " ")
    .replace(ENTITY, " ");
  return code ? `${prose}\n${code}` : prose;
}
