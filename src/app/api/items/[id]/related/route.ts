import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { listRelatedItems } from "@/lib/relations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/items/[id]/related — items linked to this one in either
// direction, body-free and deduplicated. Each row carries matchState
// ('confirmed' | 'suggested') and the roles that link it; consumers wanting
// only trusted edges filter on matchState.
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json({ items: await listRelatedItems(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
