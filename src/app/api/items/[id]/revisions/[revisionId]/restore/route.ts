import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { restoreRevision } from "@/lib/item-mutations";

export const dynamic = "force-dynamic";

// POST /api/items/[id]/revisions/[revisionId]/restore — set the item's body
// back to this snapshot. The pre-restore body is snapshotted first
// (undebounced) so the restore itself can be undone.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; revisionId: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const params = await context.params;
    const id = asUuid(params.id, "id");
    const revisionId = asUuid(params.revisionId, "revisionId");
    return NextResponse.json({
      item: await restoreRevision(owner.id, id, revisionId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
