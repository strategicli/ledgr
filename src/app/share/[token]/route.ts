// Public share link render (slice 31, PRD §4.12). An unguessable token →
// the item's self-contained print render, with no Clerk on the path (it's in
// the public-route set in proxy.ts). Read-only: it serves the same flat
// document the Save Offline print view does (mentions as plain names, no app
// chrome, no navigation into the owner's data), and the print-to-PDF leg is
// the page's Print/PDF button. A revoked or unknown token, or a trashed item,
// is a plain 404.
import { NextResponse } from "next/server";
import { renderPrintDocument } from "@/lib/print-html";
import { resolveShareToken } from "@/lib/share";
import { resolveMentions } from "@/lib/mentions";
import { bodyMarkdown } from "@/lib/body";
import { collectMentionIdsFromMarkdown } from "@/lib/editor/mention-markdown";
import { captureError, createLogger } from "@/lib/log";

export const dynamic = "force-dynamic";

const NOT_FOUND = "This link is not available. It may have been revoked.";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  let shared;
  try {
    shared = await resolveShareToken(token);
  } catch (err) {
    const log = createLogger("share");
    await captureError("share", err, { correlationId: log.correlationId });
    return new NextResponse("Something went wrong.", { status: 500 });
  }
  if (!shared) return new NextResponse(NOT_FOUND, { status: 404 });

  // Type-aware @-mention icons unless this link was created with them off
  // (showIcons defaults on). The flag rides the token, so the recipient renders
  // exactly what the owner chose. Resolved owner-scoped against the link's owner.
  const showIcons = shared.options.showIcons ?? true;
  const mentions = showIcons
    ? await resolveMentions(
        shared.ownerId,
        collectMentionIdsFromMarkdown(bodyMarkdown(shared.body))
      )
    : undefined;

  const html = renderPrintDocument(shared.title, shared.body, {
    footerHtml: "Shared from Ledgr · read-only",
    mentions,
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Statically cacheable at the CDN (PRD §6.5) so a popular link barely
      // touches the origin, but a short window so revocation propagates fast:
      // revocation is immediate at the origin, and at most ~60s at the edge.
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      // Don't let a shared link leak into search indexes or referrers.
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
