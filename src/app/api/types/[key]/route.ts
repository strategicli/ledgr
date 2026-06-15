import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  deleteType,
  getType,
  parseTypeInput,
  softDeleteTypeWithItems,
  updateType,
} from "@/lib/types";

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

// DELETE /api/types/[key] — soft-delete to Trash (ADR-058). Blocked for system
// types. By default it's blocked while live items reference the type (the store
// names how many). With ?withItems=1 it moves the type AND its items to Trash
// together (recoverable for the retention window; see softDeleteTypeWithItems).
export async function DELETE(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const withItems =
      new URL(request.url).searchParams.get("withItems") === "1";
    if (withItems) {
      const { deletedItems } = await softDeleteTypeWithItems(owner.id, key);
      return NextResponse.json({ ok: true, deletedItems });
    }
    await deleteType(key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
