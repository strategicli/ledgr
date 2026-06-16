// Reorder the owner's dashboards (drag in the switcher). Body: the dashboard
// ids in their new order; each id's array index becomes its position.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { reorderDashboards } from "@/lib/dashboards";
import { ItemError } from "@/lib/items";

export const dynamic = "force-dynamic";

// PUT /api/dashboards/reorder — body: { dashboardIds: string[] }
export async function PUT(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { dashboardIds?: unknown };
    if (!Array.isArray(body.dashboardIds)) {
      throw new ItemError("bad_request", "dashboardIds must be an array");
    }
    const ids = body.dashboardIds.map((v) => asUuid(v, "dashboardIds[]"));
    await reorderDashboards(owner.id, ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
