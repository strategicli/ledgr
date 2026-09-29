// Fill an empty Website Page from a starter (explorations/website-pages.md): the
// starter's sample markdown becomes the body and its suggested look the page's
// design. Refuses a page that already has content, so a click can never
// overwrite someone's writing. Owner-scoped, signed-in only.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { routeGate } from "@/lib/modules/gate";
import { starterById } from "@/modules/website-pages/lib/starters";
import { applyStarter, PublishError } from "@/modules/website-pages/lib/service";

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
    await applyStarter(owner.id, itemId, starter.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PublishError) {
      return NextResponse.json({ error: err.message }, { status: err.message.includes("content") ? 409 : 400 });
    }
    return errorResponse(err);
  }
}
