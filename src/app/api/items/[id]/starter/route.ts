// Fill an empty Website Page from a starter (explorations/website-pages.md): the
// starter's sample markdown becomes the body and its suggested look the page's
// design. Refuses a page that already has content, so a click can never
// overwrite someone's writing. Owner-scoped, signed-in only.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { routeGate } from "@/lib/modules/gate";
import { getItem } from "@/lib/items";
import { bodyMarkdown, MARKDOWN_FORMAT } from "@/lib/body";
import { updateItem } from "@/lib/item-mutations";
import { WEBSITE_PAGE_TYPE } from "@/modules/website-pages/manifest";
import { starterById } from "@/modules/website-pages/lib/starters";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "website-pages");
  if (off) return off;
  try {
    const itemId = asUuid((await ctx.params).id, "id");
    const { starterId } = (await req.json().catch(() => ({}))) as { starterId?: unknown };
    const starter = typeof starterId === "string" ? starterById(starterId) : undefined;
    if (!starter) return NextResponse.json({ error: "unknown starter" }, { status: 400 });
    const item = await getItem(owner.id, itemId);
    if (!item || item.type !== WEBSITE_PAGE_TYPE) {
      return NextResponse.json({ error: "not a website page" }, { status: 404 });
    }
    if (bodyMarkdown(item.body).trim()) {
      return NextResponse.json({ error: "this page already has content" }, { status: 409 });
    }
    await updateItem(owner.id, itemId, {
      body: { format: MARKDOWN_FORMAT, text: starter.body },
      propertyPatch: { design: starter.design },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
