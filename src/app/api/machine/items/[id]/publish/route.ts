// POST|DELETE /api/machine/items/[id]/publish, body { pageId }: publish an item
// to a Website Page, or take it off (the Website Pages module; the same
// publishToPage / unpublishFromPage the app and MCP use). POST answers
// { published: true, slug, publishedAt }; DELETE { published: false }. A page
// that isn't a Website Page, or an unknown item, is a named 400/404.
import { asUuid } from "@/lib/api";
import { publishToPage, unpublishFromPage } from "@/modules/website-pages/lib/publish";
import { verifyApiRequest } from "@/lib/auth/credentials";
import { json, preflight, withMachineOwner } from "@/modules/website-pages/lib/machine";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

async function pageIdOf(request: Request): Promise<string> {
  const body = (await request.json().catch(() => ({}))) as { pageId?: unknown };
  return asUuid(body.pageId, "pageId");
}

export async function POST(request: Request, ctx: Ctx) {
  if (!(await verifyApiRequest(request.headers.get("authorization")))) return json({ error: "unauthorized" }, 401);
  return withMachineOwner(request, async (ownerId) => {
    const id = asUuid((await ctx.params).id, "id");
    const pub = await publishToPage(ownerId, await pageIdOf(request), id);
    return { published: true, slug: pub.slug, publishedAt: pub.at };
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  if (!(await verifyApiRequest(request.headers.get("authorization")))) return json({ error: "unauthorized" }, 401);
  return withMachineOwner(request, async (ownerId) => {
    const id = asUuid((await ctx.params).id, "id");
    await unpublishFromPage(ownerId, await pageIdOf(request), id);
    return { published: false };
  });
}
