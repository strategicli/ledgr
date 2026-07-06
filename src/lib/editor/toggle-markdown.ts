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
// the tag, CRLF, and missing/extra blank lines; the body is lazy so a nested
// </details> would close the outer one early (nested toggles are a known
// limitation, not a common shape). Returns null when `src` doesn't open with
// a <details> disclosure in our shape.
const TOGGLE_BLOCK_RE =
  /^<details(\s+open)?[^>]*>[ \t]*\r?\n<summary>([\s\S]*?)<\/summary>[ \t]*\r?\n+([\s\S]*?)\r?\n+<\/details>[ \t]*(?:\r?\n|$)/;

export function matchToggleBlock(src: string): ToggleMatch | null {
  const m = TOGGLE_BLOCK_RE.exec(src);
  if (!m) return null;
  return {
    open: !!m[1],
    summary: m[2].trim(),
    body: m[3].trim(),
    raw: m[0],
  };
}

// Where the next possible toggle starts, for marked's tokenizer `start` hook
// (so it isn't asked to run on every character). -1 / src.length when none.
export function nextToggleStart(src: string): number {
  const i = src.indexOf("<details");
  return i < 0 ? src.length : i;
}
