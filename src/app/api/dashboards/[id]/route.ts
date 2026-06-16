// Per-dashboard API (dashboards epoch). PATCH is the single persistence path
// for widget edits and react-grid-layout drag/resize alike: the client merges
// the new layout into the widget array and sends the whole DashboardInput.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import {
  deleteDashboard,
  getDashboard,
  parseDashboardInput,
  updateDashboard,
} from "@/lib/dashboards";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/dashboards/[id]
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json({ dashboard: await getDashboard(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/dashboards/[id] — replace name + focus + widgets + layout.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    const input = parseDashboardInput(await request.json());
    return NextResponse.json({ dashboard: await updateDashboard(owner.id, id, input) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/dashboards/[id]
export async function DELETE(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    await deleteDashboard(owner.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
