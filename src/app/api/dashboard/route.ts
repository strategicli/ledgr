// Dashboard config API (slice 29, PRD §4.11). PUT persists a drag-reorder of
// the pinned view widgets; POST pins or unpins a single view. The dashboard
// page itself reads server-side, so there's no GET.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { pinView, setDashboardOrder, unpinView } from "@/lib/views";

export const dynamic = "force-dynamic";

// PUT /api/dashboard — body: { viewIds: string[] } in new order.
export async function PUT(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { viewIds?: unknown };
    if (!Array.isArray(body.viewIds)) {
      throw new ItemError("bad_request", "viewIds must be an array");
    }
    const ids = body.viewIds.map((v) => asUuid(v, "viewIds[]"));
    await setDashboardOrder(owner.id, ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// POST /api/dashboard — body: { viewId, pinned } to add/remove a widget.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { viewId?: unknown; pinned?: unknown };
    const viewId = asUuid(body.viewId, "viewId");
    if (typeof body.pinned !== "boolean") {
      throw new ItemError("bad_request", "pinned must be a boolean");
    }
    if (body.pinned) await pinView(owner.id, viewId);
    else await unpinView(owner.id, viewId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
