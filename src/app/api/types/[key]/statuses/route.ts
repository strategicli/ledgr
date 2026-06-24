import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { setTypeStatusConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

// PATCH /api/types/[key]/statuses  { mode: 'none'|'checkbox'|'select', statuses?:
// StatusDef[] | null } — save a type's status configuration: its display MODE
// (ADR-106) and, in 'select' mode, its configurable statuses (Tasks Polish S2,
// ADR-082). A focused route like /layout + /quick-capture so the status editor
// can't clobber a whole-definition builder edit. setTypeStatusConfig validates,
// writes the schema only in 'select' mode (defer-by-hiding), and re-syncs every
// item's denormalized category when the schema changes.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      mode?: unknown;
      statuses?: unknown;
    };
    const def = await setTypeStatusConfig(key, body.mode, body.statuses ?? null);
    return NextResponse.json({
      statusMode: def.statusMode,
      statusSchema: def.statusSchema,
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
