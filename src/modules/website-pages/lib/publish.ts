// The server half of publishing (publications.ts holds the pure list logic).
// Owner-scoped throughout. Publishing writes the PAGE item through updateItem,
// so it gets the same revision, sync and change feed as any other edit.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations } from "@/db/schema";
import { updateItem } from "@/lib/item-mutations";
import { TAGS_ROLE } from "@/lib/tags";
import { WEBSITE_PAGE_TYPE } from "@/modules/website-pages/manifest";
import {
  PUBLICATIONS_KEY,
  readPublications,
  withPublished,
  withUnpublished,
  type Publication,
} from "@/modules/website-pages/lib/publications";

export type PageSummary = { id: string; title: string; publications: Publication[] };

// Every live Website Page the owner has, with its publish list. Pages are few,
// so "which pages is this item on" reads them all rather than indexing jsonb.
export async function listPages(ownerId: string): Promise<PageSummary[]> {
  const rows = await getDb()
    .select({ id: items.id, title: items.title, properties: items.properties })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, WEBSITE_PAGE_TYPE),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );
  return rows
    .map((r) => ({ id: r.id, title: r.title, publications: readPublications(r.properties) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export class PublishError extends Error {}

async function loadPage(ownerId: string, pageId: string): Promise<PageSummary> {
  const page = (await listPages(ownerId)).find((p) => p.id === pageId);
  if (!page) throw new PublishError("page not found");
  return page;
}

export async function publishToPage(ownerId: string, pageId: string, itemId: string) {
  if (pageId === itemId) throw new PublishError("a page cannot be published on itself");
  const page = await loadPage(ownerId, pageId);
  const [item] = await getDb()
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId), isNull(items.deletedAt)));
  if (!item) throw new PublishError("item not found");
  const next = withPublished(page.publications, item);
  if (next !== page.publications) {
    await updateItem(ownerId, pageId, { propertyPatch: { [PUBLICATIONS_KEY]: next } });
  }
  return next.find((p) => p.id === itemId)!;
}

export async function unpublishFromPage(ownerId: string, pageId: string, itemId: string) {
  const page = await loadPage(ownerId, pageId);
  const next = withUnpublished(page.publications, itemId);
  if (next.length !== page.publications.length) {
    await updateItem(ownerId, pageId, { propertyPatch: { [PUBLICATIONS_KEY]: next } });
  }
}

// A published item as a page renders it. `tags` are the tag names on it, for a
// collection's `tag:` filter. Bodies are read here on purpose: a site renders
// excerpts and subpages from them (the no-body rule is for app list queries).
export type PublishedItem = {
  id: string;
  slug: string;
  publishedAt: string;
  title: string;
  type: string;
  body: unknown;
  tags: string[];
};

// Everything this page publishes that still exists, newest publish first. An
// item that went to Trash drops off the site without touching the list, so
// restoring it brings its subpage back at the same address.
export async function listPublishedItems(
  ownerId: string,
  publications: Publication[]
): Promise<PublishedItem[]> {
  if (publications.length === 0) return [];
  const ids = publications.map((p) => p.id);
  const db = getDb();
  const rows = await db
    .select({ id: items.id, title: items.title, type: items.type, body: items.body })
    .from(items)
    .where(and(eq(items.ownerId, ownerId), inArray(items.id, ids), isNull(items.deletedAt)));
  const tagRows = await db
    .select({ sourceId: relations.sourceId, name: items.title })
    .from(relations)
    .innerJoin(items, eq(items.id, relations.targetId))
    .where(and(inArray(relations.sourceId, ids), eq(relations.role, TAGS_ROLE), isNull(items.deletedAt)));
  const tagsOf = new Map<string, string[]>();
  for (const t of tagRows) tagsOf.set(t.sourceId, [...(tagsOf.get(t.sourceId) ?? []), t.name]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return publications
    .filter((p) => byId.has(p.id))
    .map((p) => {
      const r = byId.get(p.id)!;
      return { id: r.id, slug: p.slug, publishedAt: p.at, title: r.title, type: r.type, body: r.body, tags: tagsOf.get(r.id) ?? [] };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
