// Pure GFM-table assembly for the editor's table node (Phase 3 editor-parity
// item, ADR-040 follow-on). The Tiptap Table extension's renderMarkdown walks
// the ProseMirror node into a grid of already-rendered cell strings and hands
// it here; keeping the string assembly + escaping pure makes it node-testable
// (the colors.ts / mention-markdown.ts discipline). The server renderer
// (markdown-it, GFM tables on by default) already turns the output back into a
// <table> for print/share/export, so this is the one canonical table shape.

// A cell may carry inline markdown (e.g. "*two*"); only the characters that
// would break the pipe grid are escaped. Newlines collapse to a space because
// a GFM table cell is single-line.
export function escapeTableCell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// rows[0] is the header row (GFM requires one). Ragged rows pad to the widest
// row so the pipes line up and marked re-parses it cleanly.
export function tableToGfm(rows: string[][]): string {
  if (rows.length === 0) return "";
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const pad = (r: string[]): string[] => {
    const cells = r.map(escapeTableCell);
    while (cells.length < cols) cells.push("");
    return cells;
  };
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const header = pad(rows[0]);
  const separator = Array.from({ length: cols }, () => "---");
  const body = rows.slice(1).map(pad);
  return [line(header), line(separator), ...body.map(line)].join("\n");
}
