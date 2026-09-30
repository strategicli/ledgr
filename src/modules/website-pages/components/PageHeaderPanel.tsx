// The top of a Website Page's canvas (Tyler, 2026-09-29: page options belong at
// the top of the page, not in the footer's Export & sharing): the site's link,
// always visible, then the collapsible Design and "Pages on this site" areas.
// Server-loaded so it paints with the page. Renders nothing unless the module
// is on and the item really is a Website Page; core canvases reach it by panel
// id through src/lib/module-panels.tsx.
import PageHeader from "@/modules/website-pages/components/PageHeader";
import { moduleOnFor } from "@/lib/modules/enabled";
import { resolveOwner } from "@/lib/owner";
import { getItem } from "@/lib/items";
import { bodyMarkdown } from "@/lib/body";
import { getSettings } from "@/lib/settings";
import { listShareTokens } from "@/modules/sharing/lib/share";
import { WEBSITE_PAGE_TYPE } from "@/modules/website-pages/manifest";
import { readDesign } from "@/modules/website-pages/lib/theme";
import { readPublications } from "@/modules/website-pages/lib/publications";
import { listPublishedItems } from "@/modules/website-pages/lib/publish";
import { STARTERS } from "@/modules/website-pages/lib/starters";

export default async function PageHeaderPanel({ itemId }: { itemId: string }) {
  const owner = await resolveOwner();
  if (!owner || !(await moduleOnFor(owner.id, "website-pages"))) return null;
  const item = await getItem(owner.id, itemId).catch(() => null);
  if (!item || item.type !== WEBSITE_PAGE_TYPE) return null;
  const [tokens, settings, published] = await Promise.all([
    listShareTokens(owner.id, itemId),
    getSettings(owner.id),
    listPublishedItems(owner.id, readPublications(item.properties)),
  ]);
  const live = tokens.find((t) => !t.revokedAt);
  return (
    <PageHeader
      itemId={itemId}
      design={readDesign(item.properties)}
      empty={!bodyMarkdown(item.body).trim()}
      token={live?.token ?? null}
      base={settings.publicUrl}
      starters={STARTERS.map((s) => ({ id: s.id, name: s.name, description: s.description }))}
      pages={published.map((p) => ({ id: p.id, title: p.title, slug: p.slug, publishedAt: p.publishedAt, type: p.type }))}
    />
  );
}
