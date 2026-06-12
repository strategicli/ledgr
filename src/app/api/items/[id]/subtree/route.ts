import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { listSubtree } from "@/lib/subtasks";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/items/[id]/subtree — the item's live descendant tree, nested,
// body-free, with an "n of m done" rollup (direct task children) on the
// root and on every node that has task children.
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json(await listSubtree(owner.id, id));
  } catch (err) {
    return errorResponse(err);
  }
}
