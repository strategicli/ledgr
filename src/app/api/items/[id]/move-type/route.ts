import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError, moveItemType } from "@/lib/items";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/items/[id]/move-type — retype an item, reconciling its properties
// (ADR-132). Body: { targetType: string, dryRun?: boolean }. With dryRun:true it
// returns { summary } (what would carry over / be surfaced / kept) without
// writing — the dialog's preview. Otherwise it commits and returns { summary,
// item }. The body change (if any properties are surfaced) snapshots a revision.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const payload = (await request.json()) as {
      targetType?: unknown;
      dryRun?: unknown;
    };
    const targetType =
      typeof payload.targetType === "string" ? payload.targetType.trim() : "";
    if (!targetType) {
      throw new ItemError("bad_request", "targetType is required");
    }
    const result = await moveItemType(owner.id, id, targetType, {
      dryRun: payload.dryRun === true,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
