// The mention ↔ markdown contract, isolated as pure functions so both the
// Tiptap mention node (client) and the round-trip verify (node) share one
// definition. A mention serializes to the exact link the v0.17 BlockNote
// serializer already emitted — [@Title](ledgr://item/<uuid>) — so existing
// exported documents and the M4 migration agree on one shape, and
// src/lib/mentions.ts can keep finding edges by parsing this URI out of the
// markdown body (its M4 rework) instead of walking JSON.

export const MENTION_URI_PREFIX = "ledgr://item/";

// A mention id is an items.id, and items.id is a uuid column. Anything else in
// that slot is prose that merely LOOKS like a mention — most often a doc or
// prompt body spelling out the syntax as `ledgr://item/<id>` — and it must not
// be treated as an edge: every consumer below feeds these straight into
// `where id in (…)`, where Postgres rejects a non-uuid with 22P02 and takes the
// whole request down. On a body save that throw landed AFTER the item row had
// already committed, so `edit_item_body` answered "internal error" on an edit
// that was in fact written, and an agent would retry the find-and-replace and
// double-apply it (2026-09-21). The same text also broke the print, share, and
// render-markdown reads. Shape-only on purpose: whether the id resolves to a
// live item is resolveMentions' job (it renders a missing target as the muted
// state), and this function can't query.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return UUID_RE.test(id) ? id : null;
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
  // slice; mentionItemId then rejects anything that isn't a uuid (an empty
  // `ledgr://item/`, or a `<id>` placeholder written out in prose).
  const re = /ledgr:\/\/item\/([^)\s]+)/g;
  for (const m of markdown.matchAll(re)) {
    const id = mentionItemId(MENTION_URI_PREFIX + m[1]);
    if (id) out.add(id);
  }
  return [...out];
}
