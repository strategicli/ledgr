// The mention ↔ markdown contract, isolated as pure functions so both the
// Tiptap mention node (client) and the round-trip verify (node) share one
// definition. A mention serializes to the exact link the v0.17 BlockNote
// serializer already emitted — [@Title](ledgr://item/<uuid>) — so existing
// exported documents and the M4 migration agree on one shape, and
// src/lib/mentions.ts can keep finding edges by parsing this URI out of the
// markdown body (its M4 rework) instead of walking JSON.

export const MENTION_URI_PREFIX = "ledgr://item/";

// Escape the bits of a title that would break the link label. Kept minimal
// and aligned with markdown.ts's escapeText for the characters that matter
// inside a [label]: brackets and backslashes.
function escapeLabel(title: string): string {
  return title.replace(/[\\[\]]/g, (c) => `\\${c}`);
}

export function mentionToMarkdown(itemId: string, title: string): string {
  const label = escapeLabel(title || "untitled");
  return `[@${label}](${MENTION_URI_PREFIX}${itemId})`;
}

// A link href back to the item id it mentions, or null if it isn't a mention
// URI. The way IN: the markdown parser sees a normal link; this is what tells
// the mention node "this link is actually a mention."
export function mentionItemId(href: string | null | undefined): string | null {
  if (typeof href !== "string") return null;
  if (!href.startsWith(MENTION_URI_PREFIX)) return null;
  const id = href.slice(MENTION_URI_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

// A link's display text back to the bare title (drops the leading "@" the
// label carries). Used when reconstructing a mention node from a parsed link.
export function mentionTitleFromLabel(label: string): string {
  const stripped = label.startsWith("@") ? label.slice(1) : label;
  return stripped || "untitled";
}

// Every distinct item id mentioned in a markdown body, in first-seen order.
// This is the markdown-native replacement for walking BlockNote JSON: the
// mention serializes to a link whose href is `ledgr://item/<id>`, so scanning
// for that prefix finds every edge the body implies. The relation sync
// (src/lib/mentions.ts) diffs this against the stored edges on every save.
export function collectMentionIdsFromMarkdown(markdown: string): string[] {
  if (!markdown) return [];
  const out = new Set<string>();
  // The href runs to the closing paren or whitespace, matching mentionItemId's
  // slice; an empty id (`ledgr://item/`) is skipped.
  const re = /ledgr:\/\/item\/([^)\s]+)/g;
  for (const m of markdown.matchAll(re)) {
    const id = m[1].trim();
    if (id) out.add(id);
  }
  return [...out];
}
