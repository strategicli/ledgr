// Plain-text extraction from a BlockNote document, maintained by app code on
// every body save so the generated tsvector indexes words, not JSON structure
// (ADR-003). Walks defensively: BlockNote's shape can grow new block and
// inline types, and unknown nodes should degrade to "whatever text they
// carry" rather than throw.

type UnknownNode = {
  text?: unknown;
  content?: unknown;
  children?: unknown;
  rows?: unknown;
  cells?: unknown;
};

function collect(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === "string") {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return;
  }
  if (typeof node !== "object") return;
  const n = node as UnknownNode;
  if (typeof n.text === "string" && n.text.trim()) out.push(n.text);
  collect(n.content, out);
  collect(n.rows, out); // table content
  collect(n.cells, out); // table rows
  collect(n.children, out);
}

// Returns null for an empty/absent body so body_text stays NULL (and the
// tsvector coalesces it away) instead of storing empty strings.
export function extractBodyText(body: unknown): string | null {
  const out: string[] = [];
  collect(body, out);
  const text = out.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}
