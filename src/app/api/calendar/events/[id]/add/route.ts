import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { promoteCalendarEvent } from "@/lib/calendar/feed";

// Add a calendar-feed event to Ledgr (ADR-094 E3): promote one cached event to a
// real `event` item. User-authed, owner-scoped. Idempotent — re-adding an
// already-added event returns the existing item id with 200.
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await params;
    const { itemId, alreadyPromoted } = await promoteCalendarEvent(
      owner.id,
      asUuid(id, "id")
    );
    return NextResponse.json(
      { itemId, alreadyPromoted },
      { status: alreadyPromoted ? 200 : 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
