import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { createLogger } from "@/lib/log";
import { routeGate } from "@/lib/modules/gate";
import { tailscaleAvailable } from "@/modules/tailscale/manifest";
import { readTailnetStatus } from "@/modules/tailscale/lib/status";
import {
  readFunnelWanted,
  readTailscaleEnabled,
  signalSupervisor,
  signinRequired,
  writeFunnelWanted,
  writeTailscaleEnabled,
} from "@/modules/tailscale/lib/switch";

// The owner's Tailscale controls (ADR-276, ADR-278), for this computer only.
//
//   GET                               the switches, sign-in, and the helper's status
//   POST {action: "connect"}          switch private access on
//   POST {action: "disconnect"}       switch it (and public access) off, sign the node out
//   POST {action: "funnel-on"}        public access; refused unless sign-in is required
//   POST {action: "funnel-off"}       back to private only
//   POST {action: "funnel-recheck"}   ask Tailscale again after fixing the tailnet
//
// The app never runs the helper itself. It flips switches in job_state and
// drops a signal file; the supervisor acts within two seconds (the Update and
// Startup door) and the helper reports back through its status file.
export const dynamic = "force-dynamic";

const log = createLogger("tailscale");
const ACTIONS = ["connect", "disconnect", "funnel-on", "funnel-off", "funnel-recheck"] as const;
type Action = (typeof ACTIONS)[number];

async function gate() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "tailscale");
  if (off) return off;
  const dir = process.env.LEDGR_SUPERVISOR_DIR;
  if (!tailscaleAvailable() || !dir) {
    return NextResponse.json({ error: "Private access runs only on a Ledgr installed on your own computer." }, { status: 400 });
  }
  return dir;
}

export async function GET() {
  const dir = await gate();
  if (dir instanceof Response) return dir;
  return NextResponse.json({
    enabled: await readTailscaleEnabled(),
    funnel: await readFunnelWanted(),
    signinRequired: await signinRequired(),
    status: await readTailnetStatus(dir),
  });
}

export async function POST(request: Request) {
  const dir = await gate();
  if (dir instanceof Response) return dir;
  let action: unknown;
  try {
    action = ((await request.json()) as { action?: unknown }).action;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!ACTIONS.includes(action as Action)) {
    return NextResponse.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  }
  if (action === "funnel-on" && !(await signinRequired())) {
    return NextResponse.json(
      { error: "Public access needs sign-in first. Set a password in User Settings → Sign-in, then try again." },
      { status: 409 }
    );
  }
  try {
    // Switches first, then the signal: the supervisor's next question to the
    // app must already get the new answer.
    if (action === "connect") await writeTailscaleEnabled(true);
    if (action === "disconnect") {
      await writeFunnelWanted(false);
      await writeTailscaleEnabled(false);
    }
    if (action === "funnel-on") await writeFunnelWanted(true);
    if (action === "funnel-off") await writeFunnelWanted(false);
    await signalSupervisor(dir, { logout: action === "disconnect", recheck: action === "funnel-recheck" });
  } catch (err) {
    log.error("tailscale request failed", { action, detail: String(err) });
    return NextResponse.json({ error: "Could not reach the local service. Is Ledgr's data folder writable?" }, { status: 502 });
  }
  log.info("tailscale request signaled to supervisor", { action });
  return NextResponse.json({ ok: true, pending: true });
}
