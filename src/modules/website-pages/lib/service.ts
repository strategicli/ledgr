// The Website Pages operations every door shares: the app's page controls, the
// machine HTTP API (/api/machine/…) and the MCP tools all call these, so the
// three can never disagree about what publishing, a starter, or a look means.
// Owner-scoped throughout.
import { bodyMarkdown, MARKDOWN_FORMAT } from "@/lib/body";
import { getItem } from "@/lib/items";
import { createItem, updateItem } from "@/lib/item-mutations";
import { listShareTokens, createShareToken } from "@/modules/sharing/lib/share";
import { WEBSITE_PAGE_TYPE } from "@/modules/website-pages/manifest";
import { FONTS, LANGUAGES, PALETTES, readDesign, type Design } from "@/modules/website-pages/lib/theme";
import { starterById, STARTERS } from "@/modules/website-pages/lib/starters";
import { listPages, listPublishedItems, PublishError } from "@/modules/website-pages/lib/publish";
import { readPublications } from "@/modules/website-pages/lib/publications";

export { PublishError };

async function liveToken(ownerId: string, itemId: string): Promise<string | null> {
  return (await listShareTokens(ownerId, itemId)).find((t) => !t.revokedAt)?.token ?? null;
}

// Every Website Page with its address, look and what it publishes. `origin` is
// the absolute base for urls (the owner's public address, else the request's).
export async function describeSites(ownerId: string, origin: string) {
  const pages = await listPages(ownerId);
  return Promise.all(
    pages.map(async (p) => {
      const item = await getItem(ownerId, p.id);
      const token = await liveToken(ownerId, p.id);
      const url = token ? `${origin}/share/${token}` : null;
      const published = await listPublishedItems(ownerId, p.publications);
      return {
        id: p.id,
        title: p.title,
        url,
        design: readDesign(item.properties),
        published: published.map((i) => ({
          id: i.id,
          title: i.title,
          type: i.type,
          tags: i.tags,
          publishedAt: i.publishedAt,
          slug: i.slug,
          url: url ? `${url}/${i.slug}` : null,
        })),
      };
    })
  );
}

// The choices a page can make, with the reasoning shown in the picker.
export function designOptions() {
  return {
    languages: Object.entries(LANGUAGES).map(([id, l]) => ({ id, name: l.name, defaultFont: l.font, whatItIs: l.diff, reachForItWhen: l.when })),
    palettes: Object.entries(PALETTES).map(([id, p]) => ({ id, name: p.name, suggested: !!p.suggested, why: p.why, light: p.light, dark: p.dark })),
    fonts: Object.entries(FONTS).map(([id, f]) => ({ id, name: f.name, why: f.why })),
    starters: STARTERS.map((s) => ({ id: s.id, name: s.name, description: s.description, design: s.design })),
  };
}

async function requirePage(ownerId: string, pageId: string) {
  const item = await getItem(ownerId, pageId).catch(() => null);
  if (!item || item.deletedAt || item.type !== WEBSITE_PAGE_TYPE) throw new PublishError("not a website page");
  return item;
}

// Change any of language / palette / font; unknown values are refused by name.
// A new language without a font brings that language's own font.
export async function setDesign(ownerId: string, pageId: string, next: Partial<Design>): Promise<Design> {
  const item = await requirePage(ownerId, pageId);
  if (next.language !== undefined && !LANGUAGES[next.language]) throw new PublishError(`unknown language "${next.language}"`);
  if (next.palette !== undefined && !PALETTES[next.palette]) throw new PublishError(`unknown palette "${next.palette}"`);
  if (next.font !== undefined && !FONTS[next.font]) throw new PublishError(`unknown font "${next.font}"`);
  const cur = readDesign(item.properties);
  const design: Design = {
    language: next.language ?? cur.language,
    palette: next.palette ?? cur.palette,
    font: next.font ?? (next.language ? LANGUAGES[next.language].font : cur.font),
  };
  await updateItem(ownerId, pageId, { propertyPatch: { design } });
  return design;
}

// Fill an EMPTY page from a starter (never overwrites writing).
export async function applyStarter(ownerId: string, pageId: string, starterId: string): Promise<Design> {
  const starter = starterById(starterId);
  if (!starter) throw new PublishError(`unknown starter "${starterId}"`);
  const item = await requirePage(ownerId, pageId);
  if (bodyMarkdown(item.body).trim()) throw new PublishError("this page already has content");
  await updateItem(ownerId, pageId, {
    body: { format: MARKDOWN_FORMAT, text: starter.body },
    propertyPatch: { design: starter.design },
  });
  return starter.design;
}

// Make a new Website Page, optionally from a starter and with a share link, in
// one call: what an assistant asked to "make me a site" needs.
export async function createSite(
  ownerId: string,
  opts: { title: string; starter?: string; design?: Partial<Design>; body?: string; share?: boolean },
  origin: string
) {
  if (opts.starter && !starterById(opts.starter)) throw new PublishError(`unknown starter "${opts.starter}"`);
  const created = await createItem(ownerId, {
    type: WEBSITE_PAGE_TYPE,
    title: opts.title,
    ...(opts.body ? { body: { format: MARKDOWN_FORMAT, text: opts.body } } : {}),
  } as never);
  const id = (created as { id: string }).id;
  if (opts.starter && !opts.body) await applyStarter(ownerId, id, opts.starter);
  const design = opts.design ? await setDesign(ownerId, id, opts.design) : readDesign((await getItem(ownerId, id)).properties);
  let url: string | null = null;
  if (opts.share !== false) url = `${origin}/share/${(await createShareToken(ownerId, id, {})).token}`;
  return { id, title: opts.title, design, url };
}

export async function publishedList(ownerId: string, pageId: string) {
  const item = await requirePage(ownerId, pageId);
  return listPublishedItems(ownerId, readPublications(item.properties));
}
