import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { toggleItemDone } from "@/lib/item-mutations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/items/[id]/complete — toggle a task between its type's default done
// and not-started status (Tasks Polish S2). The done-checkbox calls this so a
// client never needs the type's status schema, and it routes through updateItem
// (recurrence-aware: moving into the done category advances a recurring task).
export async function POST(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json({ item: await toggleItemDone(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
