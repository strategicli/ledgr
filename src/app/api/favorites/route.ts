import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  getFavoriteItems,
  reorderFavorites,
  setFavorite,
} from "@/lib/favorites";

export const dynamic = "force-dynamic";

// GET /api/favorites — the owner's starred items, resolved to body-free rows in
// saved order (for the nav flyout).
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ items: await getFavoriteItems(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/favorites — star or unstar one item: { itemId, favorite: boolean }.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { itemId?: unknown; favorite?: unknown };
    if (typeof body.itemId !== "string" || typeof body.favorite !== "boolean") {
      return NextResponse.json({ error: "itemId and favorite required" }, { status: 400 });
    }
    const favorited = await setFavorite(owner.id, body.itemId, body.favorite);
    return NextResponse.json({ favorited });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// PATCH /api/favorites — persist a drag reorder: { order: string[] }.
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { order?: unknown };
    if (!Array.isArray(body.order) || body.order.some((x) => typeof x !== "string")) {
      return NextResponse.json({ error: "order must be a string[]" }, { status: 400 });
    }
    await reorderFavorites(owner.id, body.order as string[]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
