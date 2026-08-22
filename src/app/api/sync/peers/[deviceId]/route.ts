import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { deletePeer, setPeerPullOnly, setPeerRevoked } from "@/lib/sync/peers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ deviceId: string }> };

// PATCH /api/sync/peers/[deviceId] {revoked?, pullOnly?} — revoke (the hub
// refuses the device's next sync) or restore, and/or flip pull-only/full
// (guardrail 1's "arming sync safely" lever). Either or both fields may be
// sent in one call; at least one is required. Owner-authed, like the
// collection route.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { deviceId } = await context.params;
    const body = (await request.json()) as { revoked?: unknown; pullOnly?: unknown };
    let requested = false;
    let found = true;
    if (typeof body.revoked === "boolean") {
      requested = true;
      found = (await setPeerRevoked(deviceId, body.revoked)) && found;
    }
    if (typeof body.pullOnly === "boolean") {
      requested = true;
      found = (await setPeerPullOnly(deviceId, body.pullOnly)) && found;
    }
    if (!requested) {
      return NextResponse.json(
        { error: "revoked or pullOnly (boolean) is required" },
        { status: 400 }
      );
    }
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
