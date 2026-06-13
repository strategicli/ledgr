import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { promoteActionItem } from "@/lib/meetings/promote";

// Promote a meeting action item into a task (slice 24, PRD §5.1). User-authed,
// owner-scoped. The new task is related to the meeting and its entities.
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await params;
    const raw = await request.json().catch(() => {
      throw new ItemError("bad_request", "request body must be JSON");
    });
    const title = (raw as { title?: unknown })?.title;
    if (typeof title !== "string") {
      throw new ItemError("bad_request", "title must be a string");
    }
    const task = await promoteActionItem(owner.id, asUuid(id, "id"), title);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
