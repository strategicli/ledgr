import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { listRevisions } from "@/lib/items";

export const dynamic = "force-dynamic";

// GET /api/items/[id]/revisions — snapshot metadata (ids + timestamps),
// newest first. Bodies stay in the DB until a restore asks for one.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json({ revisions: await listRevisions(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
