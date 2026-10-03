// Shared door for the phone-facing /api/machine/* routes (ADR-288): `api`-scope
// bearer auth, the single owner, open CORS (the token IS the credential, there
// are no cookies to protect, same reasoning as /api/machine/items), strict
// query parameters, and error mapping. The older machine routes inline this;
// new ones share it so the posture can't drift route by route.
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { verifyApiRequest } from "@/lib/auth/credentials";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { unknownParams, unknownParamsError } from "@/lib/machine/query";

export function machineHttp(methods: string) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": `${methods}, OPTIONS`,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  const cors = <T extends Response>(res: T): T => {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  };
  const json = (body: unknown, status = 200) =>
    cors(NextResponse.json(body, { status }));

  return {
    cors,
    json,
    options: () => cors(new NextResponse(null, { status: 204 })),

    // 401 without a valid `api` credential, 503 without an owner; otherwise
    // the owner id. Pass `known` to also reject unknown query parameters (400,
    // naming them) and get the parsed params back.
    async authorize(
      request: Request,
      known?: ReadonlySet<string>
    ): Promise<{ ownerId: string; params: URLSearchParams } | NextResponse> {
      if (!(await verifyApiRequest(request.headers.get("authorization")))) {
        return json({ error: "unauthorized" }, 401);
      }
      const ownerId = await resolveMachineOwner();
      if (!ownerId) return json({ error: "owner not configured" }, 503);
      const params = new URL(request.url).searchParams;
      if (known) {
        const unknown = unknownParams(params, known);
        if (unknown.length > 0) {
          return json({ error: unknownParamsError(unknown, known) }, 400);
        }
      }
      return { ownerId, params };
    },

    // JSON object body, or a 400 response.
    async body(request: Request): Promise<Record<string, unknown> | NextResponse> {
      try {
        const b = await request.json();
        if (b && typeof b === "object" && !Array.isArray(b)) {
          return b as Record<string, unknown>;
        }
      } catch {
        // fall through
      }
      return json({ error: "request body must be a JSON object" }, 400);
    },

    // ItemError -> 4xx verbatim; anything else captured with a correlation id.
    fail: async (err: unknown) => cors(await errorResponse(err)),
  };
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;
