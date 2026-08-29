// Orphaned-files sweep (ADR-233, the Data Hygiene page's first real tool).
// GET scans: every object in storage under the owner's prefix with no
// attachment row behind it. DELETE removes them (it re-scans server-side, so a
// file uploaded after the scan the owner is looking at can never be caught —
// its row exists). Owner-scoped both ways.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { deleteOrphanedObjects, findOrphanedObjects } from "@/lib/attachments";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const owner = await requireOwner();
    if (owner instanceof NextResponse) return owner;
    const orphans = await findOrphanedObjects(owner.id);
    return NextResponse.json({
      orphans,
      totalBytes: orphans.reduce((a, o) => a + o.sizeBytes, 0),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    const owner = await requireOwner();
    if (owner instanceof NextResponse) return owner;
    return NextResponse.json(await deleteOrphanedObjects(owner.id));
  } catch (err) {
    return errorResponse(err);
  }
}
