import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { getRevision } from "@/lib/items";

export const dynamic = "force-dynamic";

// GET /api/items/[id]/revisions/[revisionId] — one snapshot's markdown text,
// for the "Show changes" diff in the version-history panel. The list route is
// metadata-only (no body in list queries); this by-id read loads the body.
export async function GET(
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
      revision: await getRevision(owner.id, id, revisionId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
