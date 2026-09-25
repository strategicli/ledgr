// Where the in-app agent can run (ADR-271). It spawns Claude Code under this
// machine's Claude login, so it belongs only on a local install that is its own
// hub: never Vercel (no login, billed per second of a held stream), never a
// spoke by default (that machine's login isn't the owner's hub login).
//
// `agentAvailable` (the machine's half) lives on the manifest, so fenced core
// (the root layout) can read it through the registry without importing this
// module. Turning the feature on for the owner is the Build → Modules switch.
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { moduleIsOn } from "@/lib/modules/gate";
import type { Owner } from "@/lib/owner";
import { agentAvailable } from "@/modules/agent/manifest";

export { agentAvailable };

// Same-origin check by host only. Behind the tunnel TLS ends at the proxy, so
// request.url says http:// while the browser's Origin says https://; comparing
// full origins refused every write from the public address. A cross-site page
// can't forge Host or X-Forwarded-Host without a preflight it would fail.
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// For every /api/agent route: the signed-in owner with the agent on, or a 404
// that doesn't admit the feature exists. Same-origin only, since the hub is
// reachable from the public internet through the tunnel. The module check is
// the shared ADR-272 gate (`moduleIsOn`), answered with a bare 404 rather than
// `routeGate`'s JSON, which would name the module.
export async function requireAgentOwner(request: Request): Promise<Owner | NextResponse> {
  if (!agentAvailable()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  if (!(await moduleIsOn(owner.id, "agent"))) return new NextResponse(null, { status: 404 });
  return owner;
}
