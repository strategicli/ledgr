// The two public entry points of a site, shared by the share routes: the home
// page (/share/<token>) and a published item's subpage (/share/<token>/<slug>).
// Both return null when the request is not theirs to answer (not a Website
// Page, or the module is off), and the caller falls back or 404s.
import { bodyMarkdown } from "@/lib/body";
import { addShareTokenToAttachmentUrls } from "@/lib/attachment-url";
import { resolveItemBodyTokens } from "@/lib/item-tokens-service";
import { moduleIsOn } from "@/lib/modules/gate";
import { getSettings } from "@/lib/settings";
import type { ResolvedShare } from "@/modules/sharing/lib/share";
import { WEBSITE_PAGE_TYPE } from "@/modules/website-pages/manifest";
import { renderWebPage } from "@/modules/website-pages/lib/page-html";
import { loadSite } from "@/modules/website-pages/lib/site";
import { readPublications } from "@/modules/website-pages/lib/publications";

async function footerFor(ownerId: string): Promise<string> {
  const name = (await getSettings(ownerId)).displayName.trim()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `Shared from ${name ? `${name}${/s$/i.test(name) ? "'" : "'s"} Ledgr` : "Ledgr"}`;
}

async function isSite(shared: ResolvedShare): Promise<boolean> {
  return shared.type === WEBSITE_PAGE_TYPE && (await moduleIsOn(shared.ownerId, "website-pages"));
}

async function homeText(shared: ResolvedShare, token: string): Promise<{ title: string; text: string }> {
  // Live {{item.*}} tokens resolve against the page's current state, as on any share.
  const resolved = await resolveItemBodyTokens(shared.ownerId, {
    id: shared.itemId,
    title: shared.title,
    body: shared.body,
  });
  return { title: resolved.title, text: addShareTokenToAttachmentUrls(bodyMarkdown(resolved.body), token) };
}

export async function renderSiteHome(shared: ResolvedShare, token: string): Promise<string | null> {
  if (!(await isSite(shared))) return null;
  const home = await homeText(shared, token);
  const { site, mentions, publicLinks } = await loadSite(shared.ownerId, token, {
    title: home.title,
    bodyText: home.text,
    properties: shared.properties,
  });
  return renderWebPage(home.title, home.text, {
    mentions,
    publicLinks,
    site,
    currentHref: site.homeHref,
    footerHtml: await footerFor(shared.ownerId),
  });
}

// A subpage exists only while its item is on the page's publish list and alive.
// Anything else (unpublished, trashed, a guessed slug) is null, which the route
// turns into the same flat 404 a revoked share link gets.
export async function renderSiteSubpage(
  shared: ResolvedShare,
  token: string,
  slug: string
): Promise<string | null> {
  if (!(await isSite(shared))) return null;
  const home = await homeText(shared, token);
  // First pass finds the item; its body's mentions then resolve with the site.
  const first = await loadSite(shared.ownerId, token, {
    title: home.title,
    bodyText: home.text,
    properties: shared.properties,
  });
  const item = first.site.items.find((i) => i.slug === slug);
  if (!item) return null;
  const { site, mentions, publicLinks } = await loadSite(
    shared.ownerId,
    token,
    { title: home.title, bodyText: home.text, properties: shared.properties },
    item.bodyText
  );
  return renderWebPage(item.title, item.bodyText, {
    mentions,
    publicLinks,
    site,
    currentHref: item.href,
    meta: { publishedAt: item.publishedAt, backHref: site.homeHref, backLabel: site.name },
    footerHtml: await footerFor(shared.ownerId),
  });
}

// Whether a share link's page is a live site that publishes this item, for the
// files route's second way in (a subpage's images belong to the subpage's item).
export async function sitePublishes(shared: ResolvedShare, itemId: string): Promise<boolean> {
  if (!(await isSite(shared))) return false;
  return readPublications(shared.properties).some((p) => p.id === itemId);
}
