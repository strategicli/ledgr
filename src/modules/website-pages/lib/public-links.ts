// Where a mention on a public Website Page may link (explorations/website-pages.md,
// "Buttons are plain markdown links"). A page is public, so the in-app
// `/items/<id>` address is never used: a stranger would meet a login wall and the
// owner's item id would leak. Instead:
//   - a Link item links to its own URL, so "@Registration form" is a real link;
//   - any other item links to its live share link, if the owner has made one;
//   - everything else renders as plain text (markdown-render's publicLinks rule).
// Owner-scoped throughout: `mentions` came from resolveMentions for this owner.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items, shareTokens } from "@/db/schema";
import type { ResolvedMention } from "@/lib/mentions";

export async function resolvePublicLinks(
  ownerId: string,
  mentions: Map<string, ResolvedMention>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...mentions.keys()];
  if (ids.length === 0) return out;
  const db = getDb();

  const linkIds = ids.filter((id) => mentions.get(id)?.type === "link");
  if (linkIds.length) {
    const rows = await db
      .select({ id: items.id, url: items.url })
      .from(items)
      .where(and(eq(items.ownerId, ownerId), inArray(items.id, linkIds)));
    for (const r of rows) if (r.url && /^https?:\/\//i.test(r.url)) out.set(r.id, r.url);
  }

  const rest = ids.filter((id) => !out.has(id));
  if (rest.length) {
    const rows = await db
      .select({ itemId: shareTokens.itemId, token: shareTokens.token })
      .from(shareTokens)
      .where(
        and(
          eq(shareTokens.ownerId, ownerId),
          inArray(shareTokens.itemId, rest),
          isNull(shareTokens.revokedAt)
        )
      )
      .orderBy(desc(shareTokens.createdAt));
    for (const r of rows) if (!out.has(r.itemId)) out.set(r.itemId, `/share/${r.token}`);
  }
  return out;
}
