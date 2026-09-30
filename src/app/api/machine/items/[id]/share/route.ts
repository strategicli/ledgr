import { NextResponse } from "next/server";
import { asUuid, errorResponse } from "@/lib/api";
import { verifyApiRequest } from "@/lib/auth/credentials";
import { routeGate } from "@/lib/modules/gate";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { createShareToken, publicShareOrigin, type ShareOptions } from "@/modules/sharing/lib/share";

// POST /api/machine/items/[id]/share — mint a public share link (sharing
// module, ADR-272): the token half of POST /api/items/[id]/share, through the
// same createShareToken. Optional body { showIcons: false }. Response:
// { token, path: "/share/<token>", url, options }. `url` is absolute: the
// owner's public address (ADR-277), else NEXT_PUBLIC_APP_URL, else this
// request's origin. An unknown item is a JSON 404; so is a Sharing module that
// is switched off for this owner.
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, status = 200): Response {
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

  const off = await routeGate(ownerId, "sharing");
  if (off) return cors(off);

  try {
    const id = asUuid((await context.params).id, "id");
    const body = (await request.json().catch(() => ({}))) as { showIcons?: unknown };
    const options: ShareOptions = body.showIcons === false ? { showIcons: false } : {};
    const row = await createShareToken(ownerId, id, options);
    const path = `/share/${row.token}`;
    const base = (await publicShareOrigin(ownerId)) ?? new URL(request.url).origin;
    return json({ token: row.token, path, url: `${base}${path}`, options: row.options });
  } catch (err) {
    if (err instanceof Error && err.message === "item not found") {
      return json({ error: "item not found" }, 404);
    }
    return cors(await errorResponse(err));
  }
}
