// Share-link issuance for one item (slice 31). Owner-scoped, Clerk-protected
// (the public render is the only unauthenticated path). GET lists this item's
// links; POST mints a new one; DELETE revokes by token. The client builds the
// absolute URL from the returned token, so this stays env-agnostic.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { createShareToken, listShareTokens, revokeShareToken } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await ctx.params;
    const itemId = asUuid(id, "id");
    const tokens = await listShareTokens(owner.id, itemId);
    return NextResponse.json({ tokens });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await ctx.params;
    const itemId = asUuid(id, "id");
    const row = await createShareToken(owner.id, itemId);
    return NextResponse.json({ token: row.token, path: `/share/${row.token}` });
  } catch (err) {
    if (err instanceof Error && err.message === "item not found") {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    return errorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    await ctx.params; // path-shaped, but the token identifies the row
    const url = new URL(request.url);
    let token = url.searchParams.get("token") ?? "";
    if (!token) {
      const body = await request.json().catch(() => ({}));
      token = typeof (body as { token?: unknown }).token === "string" ? (body as { token: string }).token : "";
    }
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    const revoked = await revokeShareToken(owner.id, token);
    return NextResponse.json({ ok: true, revoked });
  } catch (err) {
    return errorResponse(err);
  }
}
