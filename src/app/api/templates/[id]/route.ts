import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  deleteTemplate,
  getTemplate,
  parseTemplateInput,
  updateTemplate,
} from "@/lib/templates";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/templates/[id]
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    return NextResponse.json({ template: await getTemplate(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/templates/[id] — replace name/body/property defaults. The type is
// immutable (the defaults are keyed to that type's schema).
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    const input = parseTemplateInput(await request.json(), "patch");
    return NextResponse.json({ template: await updateTemplate(owner.id, id, input) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/templates/[id]
export async function DELETE(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    await deleteTemplate(owner.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
