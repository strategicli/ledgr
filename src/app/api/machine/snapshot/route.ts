import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { captureError, createLogger } from "@/lib/log";
import { readSnapshotsEnabled, runSnapshot, snapshotTarget } from "@/modules/snapshots/lib/snapshot-settings";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { moduleIsOn } from "@/lib/modules/gate";

// Hourly local snapshot (the "time machine"). Triggered by the supervisor's own
// scheduler over loopback, through the same machine-token door as every other
// scheduled job (ADR-214) — so there is no new auth path, no new state file, and
// a failure already reports itself the way a failing cron does.
//
// The work itself is `runSnapshot`, shared with the owner's "Snapshot now"
// button, so the scheduled and manual paths cannot drift apart.
//
// LOCAL PEERS ONLY, and the guard is the point rather than a formality: a cloud
// deployment has no disk to write to and no local cluster to dump.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const target = snapshotTarget();
  if (!target) {
    return NextResponse.json(
      { error: "snapshots are a local-peer feature (no supervisor directory here)" },
      { status: 400 }
    );
  }

  // The owner's switch (ADR-222). The supervisor schedules this every hour
  // regardless; whether it does anything is a setting the owner can flip from
  // the GUI, so turning restore points on never means editing a config file.
  // Not an error and not a failure — the scheduler should record a clean run.
  if (!(await readSnapshotsEnabled())) {
    return NextResponse.json({ ok: true, skipped: "snapshots are switched off" });
  }
  // The owner-level switch (Build → Modules, ADR-272 step 4). This is a shared
  // job, not an owned one, so the step 3 job verdict never runs for it and the
  // module is checked here. A clean skip, like the per-install switch above.
  const ownerId = await resolveMachineOwner();
  if (ownerId && !(await moduleIsOn(ownerId, "snapshots"))) {
    return NextResponse.json({ ok: true, skipped: "the snapshots module is off" });
  }

  const log = createLogger("snapshot");
  try {
    const result = await runSnapshot(target);
    log.info("snapshot taken", { ...result, removed: result.removed.length });
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    // No silent failures: this lands in error_log, counts on /health, and the
    // supervisor's cron state records it too.
    await captureError("snapshot", err, { correlationId: log.correlationId });
    return NextResponse.json(
      {
        ok: false,
        correlationId: log.correlationId,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
