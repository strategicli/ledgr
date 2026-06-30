import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { getItemVersion } from "@/lib/items";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/items/[id]/version — the item's updated_at only (ADR-134). The open
// canvas polls this when its tab regains focus to detect an edit made on another
// device, without paying for the full item body. Owner-scoped via requireOwner.
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const { updatedAt } = await getItemVersion(owner.id, id);
    return NextResponse.json({ updatedAt: updatedAt.toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
