import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { captureError, createLogger } from "@/lib/log";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { standDownDetail } from "@/lib/job-owners";
import { moduleIsOn } from "@/lib/modules/gate";
import { purgeAgentData } from "@/modules/agent/lib/chat";

// Nightly in-app agent cleanup (ADR-271), run by the hub supervisor: side chats
// nobody kept are gone 7 days after their last activity, and approval and
// inline-edit records after 90. Deterministic, no model (Principle 3).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const log = createLogger("agent-purge");
  try {
    // A shared job, so the supervisor's module verdict does not cover it: the
    // route checks the agent module itself (ADR-272 step 4) and stands down
    // with a 200 while it is off, so the scheduler records no failure.
    const ownerId = await resolveMachineOwner();
    if (ownerId && !(await moduleIsOn(ownerId, "agent"))) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "module-off",
        detail: standDownDetail("module-off", null),
      });
    }
    const result = await purgeAgentData();
    log.info("agent purge finished", result);
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    await captureError("agent-purge", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
