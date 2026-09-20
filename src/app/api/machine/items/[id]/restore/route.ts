import { NextResponse } from "next/server";
import { asUuid, errorResponse } from "@/lib/api";
import { verifyApiRequest } from "@/lib/auth/credentials";
import { restoreItem } from "@/lib/item-mutations";
import { resolveMachineOwner } from "@/lib/machine/owner";

// POST /api/machine/items/[id]/restore — bring a trashed item back (ADR-267):
// the token half of POST /api/items/[id]/restore, through the same restoreItem.
// The item returns with the children that went to Trash in the same delete
// (matched on the shared deleted_at); a child trashed separately earlier stays
// put. If the item's type was itself in Trash, restoring revives the type
// (ADR-058). Response: { id, restored: <rows brought back> }. An id that isn't
// in Trash is a JSON 404 ("item not found in trash").
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function cors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, status = 200): NextResponse {
  return cors(NextResponse.json(body, { status }));
}

export function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const identity = await verifyApiRequest(request.headers.get("authorization"));
  if (!identity) {
    return json({ error: "unauthorized" }, 401);
  }

  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    return json({ error: "owner not configured" }, 503);
  }

  try {
    const id = asUuid((await context.params).id, "id");
    const r = await restoreItem(ownerId, id);
    return json({ id, restored: r.restored });
  } catch (err) {
    return cors(await errorResponse(err));
  }
}
