// Pure markdown assembly + matching for the editor's collapsible "toggle" block
// (a <details>/<summary> disclosure). Keeping the string shape and the matcher
// pure makes them node-testable, the colors.ts / table-markdown.ts discipline.
//
// Canonical shape (blank lines are load-bearing): the blank line after
// </summary> and before </details> means CommonMark/markdown-it parses the
// BODY as ordinary markdown while the <details>/<summary> lines pass straight
// through as raw HTML (server render has html:true, markdown-render.ts). The
// editor's own re-parse doesn't rely on those blanks — a custom block tokenizer
// (toggle-extension.ts) claims the whole span before marked's html-block rule
// can split it. So one shape serves both the editor and every server render.
//
//   <details open>
//   <summary>SUMMARY (inline markdown)</summary>
//
//   BODY (block markdown)
//
//   </details>

// Assemble the block. `summaryMd` is already-rendered inline markdown; `bodyMd`
// is already-rendered block markdown (both from the manager's renderChildren).
// A blank summary keeps a single space so <summary> is never empty; an empty
// body still round-trips (the parser injects an empty paragraph).
export function toggleToMarkdown(
  summaryMd: string,
  bodyMd: string,
  open: boolean
): string {
  const summary = summaryMd.trim() || " ";
  const body = bodyMd.trim();
  const tag = open ? "<details open>" : "<details>";
  return `${tag}\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

export type ToggleMatch = {
  open: boolean;
  summary: string; // raw inline markdown between <summary>…</summary>
  body: string; // raw block markdown between the blank lines
  raw: string; // the full matched span (marked needs this to advance)
};

// Match a toggle block at the START of `src`. Tolerant of extra attributes on
// the tag, CRLF, and missing/extra blank lines. Toggles NEST: the closing
// </details> is found by counting <details>/</details> lines, so an inner
// toggle's close can't end the outer one early (the old lazy regex did, and the
// inner toggle then saved as escaped text). Returns null when `src` doesn't open
// with a <details> disclosure in our shape, or never closes.
const OPEN_RE = /^<details(\s+open)?[^>]*>[ \t]*\r?\n<summary>([\s\S]*?)<\/summary>[ \t]*(?:\r?\n|$)/;
const OPEN_LINE = /^[ \t]*<details(?:\s[^>]*)?>/;
const CLOSE_LINE = /^[ \t]*<\/details>[ \t]*$/;

export function matchToggleBlock(src: string): ToggleMatch | null {
  const head = OPEN_RE.exec(src);
  if (!head) return null;
  let depth = 1;
  let offset = head[0].length;
  while (offset < src.length) {
    const nl = src.indexOf("\n", offset);
    const lineEnd = nl < 0 ? src.length : nl + 1;
    const line = src.slice(offset, lineEnd).replace(/\r?\n$/, "");
    if (OPEN_LINE.test(line)) depth++;
    else if (CLOSE_LINE.test(line) && --depth === 0) {
      return {
        open: !!head[1],
        summary: head[2].trim(),
        body: src.slice(head[0].length, offset).trim(),
        raw: src.slice(0, lineEnd),
      };
    }
    offset = lineEnd;
  }
  return null;
}

// Where the next possible toggle starts, for marked's tokenizer `start` hook
// (so it isn't asked to run on every character). -1 / src.length when none.
export function nextToggleStart(src: string): number {
  const i = src.indexOf("<details");
  return i < 0 ? src.length : i;
}
