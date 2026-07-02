import { NextResponse } from "next/server";
import {
  asUuid,
  errorResponse,
  parseItemPayload,
  requireOwner,
} from "@/lib/api";
import { getItem } from "@/lib/items";
import { softDeleteItem, updateItem } from "@/lib/item-mutations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/items/[id] — the one place a body is read.
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json({ item: await getItem(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/items/[id] — partial update; a body change snapshots a revision
// (debounced) and refreshes body_text for search.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const patch = parseItemPayload(await request.json(), "patch");
    return NextResponse.json({ item: await updateItem(owner.id, id, patch) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/items/[id] — soft delete to Trash; cascades to live children.
export async function DELETE(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json(await softDeleteItem(owner.id, id));
  } catch (err) {
    return errorResponse(err);
  }
}
