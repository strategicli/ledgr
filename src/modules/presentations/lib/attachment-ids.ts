// Pure helper shared by inline-images.ts (which also touches the DB/storage)
// and the DB-free verify script: find every attachment id an offline download
// needs to fetch bytes for.

// A stable attachment address as it appears in rendered slide HTML, e.g.
// src="/files/<uuid>" (mirrors attachment-url.ts's STABLE_URL, but scanning
// inside a larger string rather than anchored to it).
export const SRC_RE = /src="\/files\/([0-9a-f-]{36})"/gi;

// The ids referenced in a block of HTML, deduped (case-insensitive), in
// first-seen order.
export function findAttachmentIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(SRC_RE)) ids.add(m[1].toLowerCase());
  return [...ids];
}
