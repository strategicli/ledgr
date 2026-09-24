// Where the in-app agent can run (ADR-271). It spawns Claude Code under this
// machine's Claude login, so it belongs only on a local install that is its own
// hub: never Vercel (no login, billed per second of a held stream), never a
// spoke by default (that machine's login isn't the owner's hub login).
//
// The supervisor marks a local install with LEDGR_SUPERVISOR_DIR and gives a
// spoke LEDGR_SYNC_HUBS; a hub has the first and not the second. LEDGR_AGENT
// (on|off) overrides for testing only. Turning the feature on for the owner is
// the Settings checkbox, never this (the config-file rule, ADR-222).
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import type { Owner } from "@/lib/owner";

export function agentAvailable(): boolean {
  const o = process.env.LEDGR_AGENT;
  if (o === "on") return true;
  if (o === "off" || process.env.VERCEL) return false;
  return !!process.env.LEDGR_SUPERVISOR_DIR && !process.env.LEDGR_SYNC_HUBS;
}

export async function agentOn(ownerId: string): Promise<boolean> {
  return agentAvailable() && (await getSettings(ownerId)).agent.enabled;
}

// For every /api/agent route: the signed-in owner with the agent on, or a 404
// that doesn't admit the feature exists. Same-origin only, since the hub is
// reachable from the public internet through the tunnel.
export async function requireAgentOwner(request: Request): Promise<Owner | NextResponse> {
  if (!agentAvailable()) return new NextResponse(null, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new NextResponse(null, { status: 403 });
  }
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  if (!(await getSettings(owner.id)).agent.enabled) return new NextResponse(null, { status: 404 });
  return owner;
}
