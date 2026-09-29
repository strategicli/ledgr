// What a Website Page publishes (explorations/website-pages.md, "Privacy fork,
// settled"). Publishing is an explicit act: an item reaches a site only through
// an entry in its page's `publications` list, never through a tag, a type, or a
// query. Tags and types only filter and order within that list.
//
// The list lives on the page item itself (properties.publications), agreed with
// Tyler 2026-09-28: no migration, it syncs between copies the way any item does,
// and every publish/unpublish is an ordinary item write with a revision behind it.
// Each entry carries the publish date (a magazine sorts by when something went
// out, not when the note was written) and the slug its subpage lives at.
//
// Pure: no DB. The server half is publish.ts.

export const PUBLICATIONS_KEY = "publications";

export type Publication = { id: string; slug: string; at: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The list off a page's properties, tolerating anything malformed a hand edit
// or an older build could leave behind: bad entries are dropped, never thrown on.
export function readPublications(properties: unknown): Publication[] {
  const raw = (properties as Record<string, unknown> | null)?.[PUBLICATIONS_KEY];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Publication[] = [];
  for (const e of raw) {
    const p = e as Partial<Publication> | null;
    if (!p || typeof p.id !== "string" || !UUID_RE.test(p.id)) continue;
    if (typeof p.slug !== "string" || !p.slug || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, slug: p.slug, at: typeof p.at === "string" ? p.at : "" });
  }
  return out;
}

// A URL-safe slug from a title: lowercase words joined by dashes, accents
// folded, capped so a long title still makes a readable address.
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "page";
}

// Publish (or re-publish) an item: a new entry gets a slug unique on this page
// and today's date; an item already published keeps its slug and date, so a
// shared subpage address never moves under a reader.
export function withPublished(
  list: Publication[],
  item: { id: string; title: string },
  now: Date = new Date()
): Publication[] {
  if (list.some((p) => p.id === item.id)) return list;
  const taken = new Set(list.map((p) => p.slug));
  const base = slugify(item.title);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return [...list, { id: item.id, slug, at: now.toISOString() }];
}

export function withUnpublished(list: Publication[], itemId: string): Publication[] {
  return list.filter((p) => p.id !== itemId);
}
