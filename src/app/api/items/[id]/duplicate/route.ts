import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { duplicateItem } from "@/lib/clone";

export const dynamic = "force-dynamic";

// POST /api/items/[id]/duplicate — clone the item (and its subtree) beside the
// original as "<title> - Copy". Returns { id, title } of the new root so the
// caller can offer a link to it.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json(await duplicateItem(owner.id, id), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
