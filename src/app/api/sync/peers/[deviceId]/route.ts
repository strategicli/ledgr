import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { deletePeer, setPeerRevoked } from "@/lib/sync/peers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ deviceId: string }> };

// PATCH /api/sync/peers/[deviceId] {revoked} — revoke (the hub refuses the
// device's next sync) or restore. Owner-authed, like the collection route.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { deviceId } = await context.params;
    const body = (await request.json()) as { revoked?: unknown };
    if (typeof body.revoked !== "boolean") {
      return NextResponse.json({ error: "revoked (boolean) is required" }, { status: 400 });
    }
    const found = await setPeerRevoked(deviceId, body.revoked);
    if (!found) {
      return NextResponse.json({ error: "no such device" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/sync/peers/[deviceId] — only for revoked devices (deleteRefusal
// in peers.ts is the rule); a live device must be revoked first.
export async function DELETE(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { deviceId } = await context.params;
    const result = await deletePeer(deviceId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
