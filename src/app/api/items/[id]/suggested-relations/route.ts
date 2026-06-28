import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { suggestedRelations } from "@/lib/discovery/score";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/items/[id]/suggested-relations — deterministically ranked items
// worth linking to this one but not linked yet (Discover, ADR-127). Body-free,
// owner-scoped, each carrying a score and reason chips. Reads the
// item_relatedness cache, computing live on a miss; the stable seam the panel
// (and a later explorer) talk to, regardless of how it's computed underneath.
// ?limit (default 8) and ?offset page through the cached set for "Show more".
export async function GET(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 8);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const result = await suggestedRelations(owner.id, id, {
      limit: Number.isFinite(limit) ? limit : 8,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
