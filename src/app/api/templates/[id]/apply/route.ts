import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { createItemFromTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/templates/[id]/apply — create a real item from the template
// (starter body + property defaults), returning it so the caller can open it.
// A distinct endpoint from POST /api/items so the "create from template" intent
// is explicit and the template store owns the seeding logic.
export async function POST(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    const item = await createItemFromTemplate(owner.id, id);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
