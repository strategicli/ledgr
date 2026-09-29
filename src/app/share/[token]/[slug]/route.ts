// A subpage of a Website Page's site (explorations/website-pages.md): a
// published item rendered inside the site's chrome, at /share/<token>/<slug>.
// Public like the share page itself: the page's token is the credential, and the
// item must be on that page's publish list. Anything else, including an item
// that was unpublished or trashed, is the same flat 404 a revoked link gets.
import { NextResponse } from "next/server";
import { resolveShareToken, SHARE_PAGE_HEADERS } from "@/modules/sharing/lib/share";
import { renderSiteSubpage } from "@/modules/website-pages/lib/serve";
import { moduleIsOn } from "@/lib/modules/gate";
import { captureError, createLogger } from "@/lib/log";

export const dynamic = "force-dynamic";

const NOT_FOUND = "This page is not available. It may have been unpublished.";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string; slug: string }> }
) {
  const { token, slug } = await ctx.params;
  try {
    const shared = await resolveShareToken(token);
    if (!shared || !(await moduleIsOn(shared.ownerId, "sharing"))) {
      return new NextResponse(NOT_FOUND, { status: 404 });
    }
    const html = await renderSiteSubpage(shared, token, slug);
    if (!html) return new NextResponse(NOT_FOUND, { status: 404 });
    return new NextResponse(html, { headers: SHARE_PAGE_HEADERS });
  } catch (err) {
    const log = createLogger("share");
    await captureError("share", err, { correlationId: log.correlationId });
    return new NextResponse("Something went wrong.", { status: 500 });
  }
}
