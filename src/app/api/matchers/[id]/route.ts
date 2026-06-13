import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { deleteMatcher } from "@/lib/matchers/store";

// Delete a matcher rule (slice 23). Owner-scoped; a 404 if it isn't the
// owner's (deleteMatcher returns 0 rows).
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await params;
    const res = await deleteMatcher(owner.id, asUuid(id, "id"));
    if (res.deleted === 0) throw new ItemError("not_found", "matcher not found");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
