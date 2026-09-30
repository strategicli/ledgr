// Publishing one item to a Website Page (explorations/website-pages.md). Owner-
// scoped, signed-in only; the public side is the share routes. GET answers the
// Publish control: every page, whether this item is on it, and (when the item is
// itself a page) what it publishes. POST publishes to a page; DELETE unpublishes.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { routeGate } from "@/lib/modules/gate";
import {
  listPages,
  listPublishedItems,
  publishToPage,
  PublishError,
  unpublishFromPage,
} from "@/modules/website-pages/lib/publish";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "website-pages");
  if (off) return off;
  try {
    const itemId = asUuid((await ctx.params).id, "id");
    const pages = await listPages(owner.id);
    const self = pages.find((p) => p.id === itemId);
    // A page's own exposure list: everything a visitor to it can reach.
    const exposes = self
      ? (await listPublishedItems(owner.id, self.publications)).map((i) => ({
          id: i.id,
          title: i.title,
          slug: i.slug,
          publishedAt: i.publishedAt,
        }))
      : null;
    return NextResponse.json({
      isPage: !!self,
      pages: pages
        .filter((p) => p.id !== itemId)
        .map((p) => {
          const pub = p.publications.find((x) => x.id === itemId);
          return { id: p.id, title: p.title, published: !!pub, slug: pub?.slug ?? null, at: pub?.at ?? null };
        }),
      exposes,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function change(req: Request, ctx: { params: Promise<{ id: string }> }, publish: boolean) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "website-pages");
  if (off) return off;
  try {
    const itemId = asUuid((await ctx.params).id, "id");
    const body = (await req.json().catch(() => ({}))) as { pageId?: unknown };
    const pageId = asUuid(body.pageId, "pageId");
    if (publish) {
      const pub = await publishToPage(owner.id, pageId, itemId);
      return NextResponse.json({ published: true, slug: pub.slug, at: pub.at });
    }
    await unpublishFromPage(owner.id, pageId, itemId);
    return NextResponse.json({ published: false });
  } catch (err) {
    if (err instanceof PublishError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return errorResponse(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return change(req, ctx, true);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return change(req, ctx, false);
}
