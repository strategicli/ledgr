// Layout blocks for Website Pages: Pandoc-style fenced divs in the markdown body.
//
//   ::: hero                 opens a block named "hero"
//   # Fall Retreat 2026      ordinary markdown inside it
//   :::                      closes the innermost open block
//
// Blocks nest by giving the outer fence more colons (`:::: carousel` around
// `::: slide`), which is Pandoc's convention and reads well in source. The
// canonical body stays one markdown document (ADR-037/040): a block is a pair of
// lines around ordinary content, so every reader that does not know about blocks
// still sees all of the content.
//
// Two consumers:
//  - The document render (share/print/export/FTS) calls stripFencedBlocks, so a
//    page body prints as clean prose with the fence lines gone.
//  - The Website Pages render calls parseFencedBlocks and lays each block out.
//
// Only a NAMED opener starts a block, and only a matched pair is stripped, so a
// stray `:::` a person typed as text is left exactly as typed. Lines inside a
// ``` or ~~~ code fence are never read as block fences.
//
// Editor contract (verify-fenced-blocks.mts): fence lines survive a rich⇄source
// flip. The editor may add a blank line after an opener, and a closer typed
// tight under a paragraph rides that paragraph as a soft break, but every fence
// stays at the start of its own line, which is all this line-based parser needs.

export type FencedNode =
  | { kind: "markdown"; text: string }
  | { kind: "block"; name: string; args: string; children: FencedNode[] };

// `::: name rest-of-line`. The name is lowercase letters, digits and dashes,
// starting with a letter; `args` is whatever follows it on the line, trimmed.
const OPEN_RE = /^[ \t]{0,3}(:{3,})[ \t]*([a-z][a-z0-9-]*)[ \t]*(.*?)[ \t]*$/;
const CLOSE_RE = /^[ \t]{0,3}(:{3,})[ \t]*$/;
const CODE_FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

type Line = { text: string; role: "text" | "open" | "close"; name?: string; args?: string };

// Classify every line, pairing openers with closers. An opener with no closer is
// demoted back to text, as is a closer with nothing open: a body is never
// reshaped by a half-typed block.
function classify(markdown: string): Line[] {
  const lines: Line[] = markdown.split("\n").map((text) => ({ text, role: "text" }));
  const stack: number[] = [];
  let codeFence = "";
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    const code = CODE_FENCE_RE.exec(text);
    if (code) {
      const char = code[1][0];
      if (!codeFence) codeFence = char;
      else if (char === codeFence) codeFence = "";
      continue;
    }
    if (codeFence) continue;
    const open = OPEN_RE.exec(text);
    if (open) {
      lines[i] = { text, role: "open", name: open[2], args: open[3] };
      stack.push(i);
      continue;
    }
    if (CLOSE_RE.test(text) && stack.length) {
      stack.pop();
      lines[i] = { text, role: "close" };
    }
  }
  for (const i of stack) lines[i] = { text: lines[i].text, role: "text" };
  return lines;
}

// Whether a body carries at least one complete block. Cheap pre-check first.
export function hasFencedBlocks(markdown: string | null | undefined): boolean {
  if (!markdown || !markdown.includes(":::")) return false;
  return classify(markdown).some((l) => l.role === "open");
}

// The body with every matched fence line removed and its content kept, for the
// document render. A removed fence leaves a blank line so the content on either
// side of it never fuses into one paragraph.
export function stripFencedBlocks(markdown: string): string {
  if (!markdown.includes(":::")) return markdown;
  return classify(markdown)
    .map((l) => (l.role === "text" ? l.text : ""))
    .join("\n");
}

// The body as a tree: top-level markdown runs interleaved with blocks, each
// block holding its own children. Empty markdown runs are dropped.
export function parseFencedBlocks(markdown: string): FencedNode[] {
  const root: FencedNode[] = [];
  const stack: { children: FencedNode[] }[] = [{ children: root }];
  let run: string[] = [];
  const flush = () => {
    const text = run.join("\n");
    if (text.trim()) stack[stack.length - 1].children.push({ kind: "markdown", text: text.trim() });
    run = [];
  };
  for (const l of classify(markdown)) {
    if (l.role === "open") {
      flush();
      const block: FencedNode = { kind: "block", name: l.name!, args: l.args ?? "", children: [] };
      stack[stack.length - 1].children.push(block);
      stack.push(block);
    } else if (l.role === "close") {
      flush();
      stack.pop();
    } else {
      run.push(l.text);
    }
  }
  flush();
  return root;
}

// Collection sections configure themselves with `key: value` lines instead of
// content (`source: Devotional`, `tag: featured`). Returns the settings and any
// lines that were not settings, so a block can mix both.
export function readBlockSettings(text: string): { settings: Record<string, string>; rest: string } {
  const settings: Record<string, string> = {};
  const rest: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^[ \t]*([a-z][a-z0-9-]*)[ \t]*:[ \t]+(.+?)[ \t]*$/.exec(line);
    if (m && !/^https?$/.test(m[1])) settings[m[1]] = m[2];
    else rest.push(line);
  }
  return { settings, rest: rest.join("\n").trim() };
}
