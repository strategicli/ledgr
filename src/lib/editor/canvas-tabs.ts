// Canvas tabs (ADR-095): split one item's markdown body into named tabs, each a
// SECTION of the same body, delimited by an invisible HTML-comment marker
// (`<!-- tab: Title -->`). The canonical body stays one markdown document
// (ADR-037/040), so every reader — render, FTS, share, print, clone, MCP — sees
// the whole thing; only the canvas knows about tabs. Human-facing readers
// flatten markers to `## Title` headings via `flattenTabs` so a shared/printed/
// exported multi-tab note reads as titled sections (the `stripBlockAnchors`
// precedent, ADR-090).
//
// A body is "tabbed" iff it contains at least one marker line; an untabbed body
// is a normal single-section document, so every existing item is unaffected.

export type CanvasTab = { title: string; body: string };

// A marker is a lone line that is exactly an HTML comment `<!-- tab: Title -->`
// (leading/trailing whitespace allowed). Chosen over `# H1`-as-tab so a stray
// heading in pasted content can't accidentally create a tab (ADR-095 §3).
const TAB_MARKER_RE = /^[ \t]*<!--[ \t]*tab:[ \t]*(.*?)[ \t]*-->[ \t]*$/;

// A title can't carry a newline or the comment terminator, so a serialized
// marker line is always valid and single-line.
export function sanitizeTabTitle(title: string): string {
  return title.replace(/-->/g, "").replace(/\s+/g, " ").trim();
}

export function hasTabs(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.split(/\r?\n/).some((l) => TAB_MARKER_RE.test(l));
}

// Parse a body into its tabs, or null when it has no markers (untabbed → the
// plain editor). Content before the first marker becomes a leading untitled tab
// so nothing is ever hidden.
export function parseTabs(text: string | null | undefined): CanvasTab[] | null {
  if (!text || !hasTabs(text)) return null;
  const tabs: { title: string; body: string[] }[] = [];
  const preamble: string[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(TAB_MARKER_RE);
    if (m) {
      cur = { title: sanitizeTabTitle(m[1] ?? ""), body: [] };
      tabs.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (preamble.join("").trim()) tabs.unshift({ title: "", body: preamble });
  return tabs.map((t) => ({ title: t.title, body: t.body.join("\n").trim() }));
}

// Serialize tabs back to one body: a marker line + content per tab.
export function serializeTabs(tabs: CanvasTab[]): string {
  return tabs
    .map((t) => `<!-- tab: ${sanitizeTabTitle(t.title)} -->\n${t.body.trim()}`.trimEnd())
    .join("\n\n");
}

// Reader transform: flatten markers to `## Title` headings so a shared/printed/
// exported multi-tab doc reads as titled sections. Untabbed text passes through.
export function flattenTabs(text: string): string {
  const tabs = parseTabs(text);
  if (!tabs) return text;
  return tabs
    .map((t) => (t.title ? `## ${t.title}\n\n${t.body}` : t.body))
    .join("\n\n")
    .trim();
}
