import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { deleteView, getView, parseViewInput, updateView } from "@/lib/views";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/views/[id]
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json({ view: await getView(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/views/[id] — replace the definition (the builder sends the whole
// thing). System views reject the edit in the store.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    const input = parseViewInput(await request.json());
    return NextResponse.json({ view: await updateView(owner.id, id, input) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/views/[id]
export async function DELETE(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    await deleteView(owner.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
