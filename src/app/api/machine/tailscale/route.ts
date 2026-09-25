import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { moduleIsOn } from "@/lib/modules/gate";
import { tailscaleAvailable } from "@/modules/tailscale/manifest";
import { readTailscaleEnabled } from "@/modules/tailscale/lib/switch";

// "Should the Tailscale helper run on this computer?" (ADR-275). Asked by the
// supervisor over loopback with its own cron token, every minute and on every
// signal file. Both switches must be on: the module for the owner, and this
// computer's own `tailscale:enabled`. The ADR-222 shape: the supervisor always
// asks and the app decides, so the owner's control is a button, not a file.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!tailscaleAvailable()) return NextResponse.json({ run: false, why: "not a local install" });
  const ownerId = await resolveMachineOwner();
  if (!ownerId || !(await moduleIsOn(ownerId, "tailscale"))) {
    return NextResponse.json({ run: false, why: "the module is off" });
  }
  const enabled = await readTailscaleEnabled();
  return NextResponse.json({ run: enabled, why: enabled ? null : "switched off on this computer" });
}
