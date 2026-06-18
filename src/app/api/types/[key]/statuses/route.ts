import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { setTypeStatusSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

// PATCH /api/types/[key]/statuses  { statuses: StatusDef[] | null } — save (or
// reset to the inherited default, with null) a type's configurable statuses
// (Tasks Polish S2, ADR-082). A focused route like /layout + /quick-capture so
// the status editor can't clobber a whole-definition builder edit; setTypeStatusSchema
// validates the schema and re-syncs every item's denormalized category.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { statuses?: unknown };
    const def = await setTypeStatusSchema(key, body.statuses ?? null);
    return NextResponse.json({ statusSchema: def.statusSchema });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
