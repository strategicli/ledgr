import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { moduleIsOn } from "@/lib/modules/gate";
import { tailscaleAvailable } from "@/modules/tailscale/manifest";
import { readFunnelWanted, readTailscaleEnabled, signinRequired, writeFunnelWanted } from "@/modules/tailscale/lib/switch";

// "Should the Tailscale helper run on this computer, and publicly?" (ADR-276,
// ADR-278). Asked by the supervisor over loopback with its own cron token,
// every minute and on every signal file. The ADR-222 shape: the supervisor
// always asks and the app decides, so the owner's control is a button.
//
//   run     the module is on for the owner AND this computer is switched on.
//   funnel  run, AND public access asked for, AND this copy requires sign-in.
// The supervisor re-checks sign-in on its own side before it passes -funnel.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!tailscaleAvailable()) return NextResponse.json({ run: false, funnel: false, why: "not a local install" });
  const ownerId = await resolveMachineOwner();
  if (!ownerId || !(await moduleIsOn(ownerId, "tailscale"))) {
    return NextResponse.json({ run: false, funnel: false, why: "the module is off" });
  }
  const run = await readTailscaleEnabled();
  let funnel = run && (await readFunnelWanted());
  if (funnel && !(await signinRequired())) {
    // Sign-in was switched off while public access was on: close it, and
    // forget the request, so switching sign-in back on never reopens it
    // without the owner asking again.
    await writeFunnelWanted(false);
    funnel = false;
  }
  return NextResponse.json({ run, funnel, why: run ? null : "switched off on this computer" });
}
