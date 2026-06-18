// DELETE /api/attachments/[id] — delete an attachment now (meeting recording
// v1b, ADR-089): the R2 bytes then the row, owner-scoped. The "delete now"
// override for retained audio (don't wait for the 30-day purge), and a general
// attachment delete. Same R2-then-row order as the purge.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { deleteAttachment } from "@/lib/attachments";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    await deleteAttachment(owner.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
