import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { runDigestNotify } from "@/lib/digest/notify";
import { resolveNotifyOwner } from "@/lib/push/owner";
import { getWebPushSender } from "@/lib/push/web-push";
import { captureError, createLogger } from "@/lib/log";
import { standDownIfNotOwner } from "@/lib/job-owner-guard";
import { stampJobRun } from "@/lib/job-owners-store";

// Digest / check-ins push (Project Type, ADR-111/PJ7). Daily, from the
// supervisor on the machine named under Scheduled work (`notify-digest`). It
// nudges about projects that have gone quiet (staleness) or have a milestone
// coming up. Push-first (the built, reachable channel); email is a flagged
// fast-follow. Per-project dedup lives in runDigestNotify; responding to a
// digest writes a checkin_reviewed event that resets the staleness clock.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const log = createLogger("notify-digest");
  const sender = getWebPushSender();
  if (!sender) {
    log.warn("push not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY unset)");
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId, error: "push not configured (runbook §1e)" },
      { status: 503 }
    );
  }

  try {
    const ownerId = await resolveNotifyOwner();
    if (!ownerId) throw new Error("no users row matches the notify owner UPN");
    // Only the machine named under Scheduled work sends this, and nobody does
    // while the Notification center module is off: push sign-ups and the inbox
    // are per machine, so two copies sending would reach different devices.
    const standDown = await standDownIfNotOwner("notify-digest", ownerId);
    if (standDown) return standDown;
    const result = await runDigestNotify(ownerId, sender);
    await stampJobRun(ownerId, "notify-digest");
    log.info("digest notify finished", { ...result });
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    await captureError("notify-digest", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
