import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { resolveDashboardData } from "@/lib/dashboard-resolve";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/dashboards/[id]/resolved — the fully fanned-out widget data for a
// dashboard (ADR-146, S5: the Desk's read-only dashboard panel). Reuses the same
// resolveDashboardData the server page uses. Date fields serialize to ISO
// strings over JSON; the client panel revives them before handing to the grid.
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const resolved = await resolveDashboardData(owner.id, id);
    if (!resolved) {
      return NextResponse.json({ error: "dashboard not found" }, { status: 404 });
    }
    return NextResponse.json({ dashboard: resolved });
  } catch (err) {
    return errorResponse(err);
  }
}
