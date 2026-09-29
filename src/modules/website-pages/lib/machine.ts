// The shared front door for Website Pages' machine HTTP API routes: an `api`
// credential (verifyApiRequest), the machine owner, the module switch, JSON
// errors, CORS. Mirrors /api/machine/items/[id]/share.
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { routeGate } from "@/lib/modules/gate";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { publicShareOrigin } from "@/modules/sharing/lib/share";
import { PublishError } from "@/modules/website-pages/lib/publish";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export function json(body: unknown, status = 200): Response {
  return cors(NextResponse.json(body, { status }));
}

export function preflight(): Response {
  return cors(new NextResponse(null, { status: 204 }));
}

// After the credential check: runs `fn` with the owner and an absolute origin
// for links, or answers the module / error case itself. A PublishError is the
// caller's mistake (a named 400); anything else goes through the usual mapping.
export async function withMachineOwner(
  request: Request,
  fn: (ownerId: string, origin: string) => Promise<unknown>
): Promise<Response> {
  const ownerId = await resolveMachineOwner();
  if (!ownerId) return json({ error: "owner not configured" }, 503);
  const off = await routeGate(ownerId, "website-pages");
  if (off) return cors(off);
  try {
    const origin = (await publicShareOrigin(ownerId)) ?? new URL(request.url).origin;
    return json(await fn(ownerId, origin));
  } catch (err) {
    if (err instanceof PublishError) return json({ error: err.message }, 400);
    return cors(await errorResponse(err));
  }
}
