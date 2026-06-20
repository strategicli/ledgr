import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { createTemplateFromItem } from "@/lib/templates";

export const dynamic = "force-dynamic";

// POST /api/templates/from-item { itemId, name? } — "Save as template" (ADR-093,
// TPL2): clone an existing item's subtree into a hidden template prototype + a
// registry row. Returns the template (with prototypeItemId) so the caller can
// open the prototype to refine it.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      itemId?: unknown;
      name?: unknown;
    };
    const itemId = asUuid(body.itemId, "itemId");
    const name = typeof body.name === "string" ? body.name : undefined;
    const template = await createTemplateFromItem(owner.id, itemId, name);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
