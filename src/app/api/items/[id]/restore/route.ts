import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { restoreItem } from "@/lib/item-mutations";

export const dynamic = "force-dynamic";

// POST /api/items/[id]/restore — bring a trashed item (and the children that
// were deleted with it) back from Trash.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json(await restoreItem(owner.id, id));
  } catch (err) {
    return errorResponse(err);
  }
}
