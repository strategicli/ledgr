import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { deleteType, getType, parseTypeInput, updateType } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

// GET /api/types/[key]
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    return NextResponse.json({ type: await getType(key) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/types/[key] — replace the editable fields (the builder sends the
// whole definition). The key itself is immutable (it's the PK + FK target).
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const input = parseTypeInput(await request.json(), "patch");
    return NextResponse.json({ type: await updateType(key, input) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/types/[key] — blocked for system types and for types still in
// use (the store throws bad_request in both cases).
export async function DELETE(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    await deleteType(key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
