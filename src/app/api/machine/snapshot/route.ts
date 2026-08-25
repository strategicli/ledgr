import { NextResponse } from "next/server";
import { verifyMachineToken } from "@/lib/auth/machine";
import { captureError, createLogger } from "@/lib/log";
import { runSnapshot, snapshotTarget } from "@/lib/snapshot-settings";

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
  const identity = verifyMachineToken(request.headers.get("authorization"), "cron");
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
