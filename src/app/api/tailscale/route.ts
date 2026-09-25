import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { createLogger } from "@/lib/log";
import { routeGate } from "@/lib/modules/gate";
import { tailscaleAvailable } from "@/modules/tailscale/manifest";
import { readTailnetStatus } from "@/modules/tailscale/lib/status";
import { readTailscaleEnabled, signalSupervisor, writeTailscaleEnabled } from "@/modules/tailscale/lib/switch";

// The owner's Tailscale controls (ADR-276), for this computer only.
//
//   GET                           this computer's switch and the helper's status
//   POST {action: "connect"}      switch it on; the supervisor starts the helper
//   POST {action: "disconnect"}   switch it off, sign the node out, forget its keys
//
// The app never runs the helper itself. It flips the switch in job_state and
// drops a signal file; the supervisor acts within two seconds (the same door as
// Update and Startup) and the helper reports back through its status file.
export const dynamic = "force-dynamic";

const log = createLogger("tailscale");

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
  return NextResponse.json({ enabled: await readTailscaleEnabled(), status: await readTailnetStatus(dir) });
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
  if (action !== "connect" && action !== "disconnect") {
    return NextResponse.json({ error: 'action must be "connect" or "disconnect"' }, { status: 400 });
  }
  try {
    // Switch first, then signal: the supervisor's next question to the app
    // must already get the new answer.
    await writeTailscaleEnabled(action === "connect");
    await signalSupervisor(dir, { logout: action === "disconnect" });
  } catch (err) {
    log.error("tailscale request failed", { action, detail: String(err) });
    return NextResponse.json({ error: "Could not reach the local service. Is Ledgr's data folder writable?" }, { status: 502 });
  }
  log.info("tailscale request signaled to supervisor", { action });
  return NextResponse.json({ ok: true, pending: true });
}
