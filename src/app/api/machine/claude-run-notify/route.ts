import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { captureError, createLogger } from "@/lib/log";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { standDownDetail } from "@/lib/job-owners";
import { moduleIsOn } from "@/lib/modules/gate";
import { retryPendingNotifications } from "@/modules/claude-runs/lib/runs";

// Claude Runs notification retry, every 15 minutes. A run whose notification
// reached nobody (no inbox row, no device took the push) is marked for the copy
// that tried, and only that copy picks it up here, so a shared job cannot
// notify twice. Stands down with a 200 while the module is off.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const log = createLogger("claude-run-notify");
  try {
    const ownerId = await resolveMachineOwner();
    if (!ownerId || !(await moduleIsOn(ownerId, "claude-runs"))) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "module-off",
        detail: standDownDetail("module-off", null),
      });
    }
    const retried = await retryPendingNotifications(ownerId);
    if (retried > 0) log.info("claude run notifications retried", { retried });
    return NextResponse.json({ ok: true, correlationId: log.correlationId, retried });
  } catch (err) {
    await captureError("claude-run-notify", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
