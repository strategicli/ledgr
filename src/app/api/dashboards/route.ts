// Dashboards collection API (dashboards epoch). GET lists the owner's
// dashboards; POST creates one. Per-dashboard reads/writes live at
// /api/dashboards/[id]; the reorder endpoint at /api/dashboards/reorder.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { createDashboard, listDashboards, parseDashboardInput } from "@/lib/dashboards";

export const dynamic = "force-dynamic";

// GET /api/dashboards
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ dashboards: await listDashboards(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/dashboards — body: DashboardInput
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const input = parseDashboardInput(await request.json());
    const dashboard = await createDashboard(owner.id, input);
    return NextResponse.json({ dashboard }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
