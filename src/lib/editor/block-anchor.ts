// Obsidian-style block anchors (ADR-090; explorations/block-linked-action-items.md).
// A promotable line in a markdown body carries a trailing "^id" marker, e.g.
//
//     Send the email about the budget ^a1b2c3
//
// The marker is the stable back-reference target: a task promoted from that line
// stores the id (properties.source.blockRef), and an in-app deep link (#^id)
// scrolls the canvas to the line. It rides as plain text in the canonical
// markdown — `marked` (the parser @tiptap/markdown uses) preserves a trailing
// "^id" verbatim (proven in verify-block-anchor), so there is NO schema change
// and NO new body-format token to parse. The one rule: the marker must never
// reach the human-facing render, so markdownToHtml/markdownToText strip it (the
// "clean share" acceptance criterion, exploration 2026-06-15).
//
// Pure and dependency-free (no markdown-it, no Tiptap), so the server render
// path and the client editor both import it and verify-block-anchor exercises it
// as plain functions. Not "use client" — it is imported by server code.

// The id shape: 6 chars of [a-z0-9] (~2.2B space), mirroring Obsidian.
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 6;

// A trailing block anchor on one line: whitespace, "^", the id, optional trailing
// whitespace, end of line. The required leading space (and the 4+ id length)
// keeps it from matching a Pandoc footnote ref ("text[^1]"), a bare superscript
// ("mc^2"), or a "^"-led line — only a deliberate trailing marker matches.
const TRAILING_ANCHOR = /[ \t]+\^([a-z0-9]{4,})[ \t]*$/;

// Whether a line is inside a fenced code block is tracked by the caller; a fence
// open/close is ``` or ~~~ (3+), optionally indented.
const FENCE = /^\s*(`{3,}|~{3,})/;

export function generateBlockId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return id;
}

// The anchor id on a single line, or null. Operates on one line; callers split on
// newlines (a body is multi-line markdown).
export function blockIdOf(line: string): string | null {
  const m = TRAILING_ANCHOR.exec(line);
  return m ? m[1] : null;
}

// The trailing anchor with the full marker length (leading gap + "^id" + any
// trailing space), or null. The editor uses markerLength to map the marker back
// to ProseMirror positions when dimming it (counting back from the block's end).
export function trailingAnchor(
  line: string
): { id: string; markerLength: number } | null {
  const m = TRAILING_ANCHOR.exec(line);
  return m ? { id: m[1], markerLength: m[0].length } : null;
}

// One line with its trailing anchor removed (and the gap trimmed). No-op if absent.
export function stripAnchorFromLine(line: string): string {
  return line.replace(TRAILING_ANCHOR, "");
}

// Strip every trailing block anchor from a markdown document, skipping fenced
// code regions so a "^id"-looking code line is left intact. The human-facing
// render (markdownToHtml/markdownToText) runs this so shared/printed/exported
// notes never show the markers.
export function stripBlockAnchors(markdown: string): string {
  if (!markdown || !markdown.includes("^")) return markdown;
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
    if (!inFence) lines[i] = stripAnchorFromLine(lines[i]);
  }
  return lines.join("\n");
}

// Whether a markdown body already carries a given anchor id (uniqueness checks).
export function hasBlockId(markdown: string, id: string): boolean {
  return markdown.split("\n").some((line) => blockIdOf(line) === id);
}

// A fresh id guaranteed not to collide with any anchor already in `markdown`.
export function uniqueBlockId(markdown: string): string {
  let id = generateBlockId();
  while (hasBlockId(markdown, id)) id = generateBlockId();
  return id;
}

// The 0-based index of the line carrying anchor `id`, or -1 (jump-to / badge
// resolution on the server or the editor host).
export function lineWithBlockId(markdown: string, id: string): number {
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (blockIdOf(lines[i]) === id) return i;
  }
  return -1;
}

// Locate a body line by a text snippet (for callers that reason about content,
// not line numbers — e.g. an MCP agent). Compares against the line's content
// with its ^anchor and any leading list/checkbox marker removed, so a snippet
// copied straight from a "- [ ] Send the email" line matches on "Send the
// email". Fenced code regions are skipped (they can't be linked anyway, and a
// stray code line shouldn't create false ambiguity). Returns the 0-based index
// of the sole match, or an { ambiguous } / { notFound } signal so the caller
// can fall back to a line number. A snippet that equals exactly one line's
// content wins even when it's a substring of others, so "Send the email"
// resolves cleanly past a longer paraphrase elsewhere.
export function findLineByText(
  markdown: string,
  snippet: string
): { index: number } | { notFound: true } | { ambiguous: number[] } {
  const needle = stripListMarker(snippet).trim();
  if (needle === "") return { notFound: true };
  const lines = markdown.split("\n");
  const contains: number[] = [];
  const exact: number[] = [];
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
    if (inFence) continue;
    const text = stripListMarker(stripAnchorFromLine(lines[i])).trim();
    if (text === "") continue;
    if (text === needle) exact.push(i);
    if (text.includes(needle)) contains.push(i);
  }
  if (exact.length === 1) return { index: exact[0] };
  if (contains.length === 1) return { index: contains[0] };
  if (contains.length === 0) return { notFound: true };
  return { ambiguous: contains };
}

// Ensure the line at 0-based `index` carries a block anchor, returning its id
// (reused if already present, freshly minted otherwise), the possibly-updated
// markdown, and whether a new anchor was appended. Refuses a blank line or a
// line in a fenced code block — a marker there can't be stripped cleanly from
// the human render (mirrors stripBlockAnchors' fence tracking). Pure and
// server-safe, so the MCP link-to-line tool reuses it.
export function ensureAnchorOnLine(
  markdown: string,
  index: number
): { id: string; markdown: string; created: boolean } | { error: string } {
  const lines = markdown.split("\n");
  if (index < 0 || index >= lines.length) {
    return { error: `line ${index + 1} is out of range (the body has ${lines.length} lines)` };
  }
  let inFence = false;
  let fenceChar = "";
  for (let i = 0; i < index; i++) {
    const fence = FENCE.exec(lines[i]);
    if (!fence) continue;
    const char = fence[1][0];
    if (!inFence) {
      inFence = true;
      fenceChar = char;
    } else if (char === fenceChar) {
      inFence = false;
      fenceChar = "";
    }
  }
  const line = lines[index];
  if (inFence) return { error: "that line is inside a fenced code block" };
  if (FENCE.test(line)) return { error: "that line is a code-fence delimiter" };
  if (line.trim() === "") return { error: "that line is blank" };
  const existing = blockIdOf(line);
  if (existing) return { id: existing, markdown, created: false };
  const id = uniqueBlockId(markdown);
  lines[index] = `${line} ^${id}`;
  return { id, markdown: lines.join("\n"), created: true };
}

// Leading-whitespace width of a line (tab = 4), for nesting comparisons.
function indentWidth(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}

// A line with its leading list/checkbox marker removed: "- [ ] do it" -> "do it",
// "  - sub" -> "sub", "1. step" -> "step". Indentation and the marker both go.
function stripListMarker(line: string): string {
  return line.replace(/^[ \t]*(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )?/, "");
}

// Pull the promotable content out of a body line (ADR-090): given the line's
// anchor id, return the task title (the line text minus its marker and the ^id)
// and a body made of the line's indented children (sub-bullets), de-indented to
// the shallowest child so they stand on their own in the task. The promote popup
// pre-fills with these. Returns null if the id isn't in the body.
export function extractPromotable(
  markdown: string,
  id: string
): { title: string; body: string } | null {
  const lines = markdown.split("\n");
  const idx = lines.findIndex((line) => blockIdOf(line) === id);
  if (idx < 0) return null;

  const title = stripListMarker(stripAnchorFromLine(lines[idx])).trim();

  const baseIndent = indentWidth(lines[idx]);
  const children: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      children.push("");
      continue;
    }
    if (indentWidth(lines[i]) <= baseIndent) break;
    children.push(stripAnchorFromLine(lines[i]));
  }
  while (children.length && children[children.length - 1].trim() === "") children.pop();

  const childIndents = children.filter((l) => l.trim() !== "").map(indentWidth);
  const minIndent = childIndents.length ? Math.min(...childIndents) : 0;
  const body = children
    .map((l) => (l.length >= minIndent ? l.slice(minIndent) : l))
    .join("\n")
    .trimEnd();

  return { title, body };
}
