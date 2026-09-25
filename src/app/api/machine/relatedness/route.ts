import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { jobState } from "@/db/schema";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { captureError, createLogger } from "@/lib/log";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { standDownDetail } from "@/lib/job-owners";
import { moduleIsOn } from "@/lib/modules/gate";
import { refreshRelatedness, RELATEDNESS_JOB_KEY } from "@/modules/relatedness/lib/refresh";

// Nightly relatedness refresh (Discover, ADR-127). A scheduler (Vercel cron /
// GitHub Actions) calls this through the machine-token door (cron scope, ADR-036)
// to recompute the item_relatedness cache a bounded batch at a time.
// Deterministic, no model (Principle 3).
export const dynamic = "force-dynamic";
// The batch is time-budgeted to ~45s; give the function headroom over Vercel's
// 10s default so a full batch can finish.
export const maxDuration = 60;

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const log = createLogger("relatedness");
  try {
    const ownerId = await resolveMachineOwner();
    if (!ownerId) {
      log.warn("relatedness: no owner resolved");
      return NextResponse.json({ ok: true, scanned: 0, note: "no owner" });
    }
    // The relatedness module is off (ADR-272 step 4): stand down with a 200,
    // like any stood-down job, so the scheduler records no failure.
    if (!(await moduleIsOn(ownerId, "relatedness"))) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "module-off",
        detail: standDownDetail("module-off", null),
      });
    }
    const result = await refreshRelatedness(ownerId);
    const value = { lastRunAt: new Date().toISOString(), lastResult: result };
    await getDb()
      .insert(jobState)
      .values({ key: RELATEDNESS_JOB_KEY, value })
      .onConflictDoUpdate({ target: jobState.key, set: { value } });
    log.info("relatedness finished", { ...result });
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    await captureError("relatedness", err, { correlationId: log.correlationId });
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId },
      { status: 500 }
    );
  }
}
