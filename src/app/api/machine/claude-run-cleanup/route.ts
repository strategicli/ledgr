import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { captureError, createLogger } from "@/lib/log";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { standDownDetail } from "@/lib/job-owners";
import { moduleIsOn } from "@/lib/modules/gate";
import { trashOldRuns } from "@/modules/claude-runs/lib/runs";

// Nightly Claude Runs cleanup (ADR-286): runs older than 60 days go to Trash.
// A shared job, so the route checks the module itself and stands down with a
// 200 while it is off.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const log = createLogger("claude-run-cleanup");
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
    const trashed = await trashOldRuns(ownerId);
    log.info("claude run cleanup finished", { trashed });
    return NextResponse.json({ ok: true, correlationId: log.correlationId, trashed });
  } catch (err) {
    await captureError("claude-run-cleanup", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
