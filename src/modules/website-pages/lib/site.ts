// Loading a site for the share routes: a Website Page (the home), everything it
// publishes, and the public address of every mention on the pages involved.
// One load per request; the render itself stays pure (page-html.ts).
import { bodyMarkdown } from "@/lib/body";
import { addShareTokenToAttachmentUrls } from "@/lib/attachment-url";
import { collectMentionIdsFromMarkdown } from "@/lib/editor/mention-markdown";
import { resolveMentions, type ResolvedMention } from "@/lib/mentions";
import { readPublications } from "@/modules/website-pages/lib/publications";
import { listPublishedItems } from "@/modules/website-pages/lib/publish";
import { resolvePublicLinks } from "@/modules/website-pages/lib/public-links";
import type { SiteContext, SiteItem } from "@/modules/website-pages/lib/page-html";

export type LoadedSite = {
  site: SiteContext;
  mentions: Map<string, ResolvedMention>;
  publicLinks: Map<string, string>;
};

export function siteHome(token: string): string {
  return `/share/${token}`;
}

export async function loadSite(
  ownerId: string,
  token: string,
  page: { title: string; bodyText: string; properties: unknown },
  // Extra markdown whose mentions must resolve too (the subpage being shown).
  alsoResolve = ""
): Promise<LoadedSite> {
  const home = siteHome(token);
  const published = await listPublishedItems(ownerId, readPublications(page.properties));
  const items: SiteItem[] = published.map((p) => ({
    id: p.id,
    slug: p.slug,
    href: `${home}/${p.slug}`,
    title: p.title,
    type: p.type,
    tags: p.tags,
    publishedAt: p.publishedAt,
    bodyText: addShareTokenToAttachmentUrls(bodyMarkdown(p.body), token),
  }));
  const mentions = await resolveMentions(
    ownerId,
    collectMentionIdsFromMarkdown(`${page.bodyText}\n\n${alsoResolve}`)
  );
  // A mention of something published on this site goes to its subpage; anything
  // else follows the ordinary public rule (a Link's URL, a live share link, text).
  const publicLinks = await resolvePublicLinks(ownerId, mentions);
  for (const i of items) publicLinks.set(i.id, i.href);
  return {
    site: { name: page.title, homeHref: home, homeMarkdown: page.bodyText, items },
    mentions,
    publicLinks,
  };
}
