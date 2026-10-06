import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { runAgendaNotify } from "@/lib/push/notify";
import { resolveNotifyOwner } from "@/lib/push/owner";
import { getWebPushSender } from "@/lib/push/web-push";
import { captureError, createLogger } from "@/lib/log";
import { standDownIfNotOwner } from "@/lib/job-owner-guard";
import { stampJobRun } from "@/lib/job-owners-store";

// Morning agenda push (slice 30, PRD §4.11). Daily, from the supervisor on the
// machine named under Scheduled work (supervisor/jobs.json `notify-agenda`).
// The day guard in runAgendaNotify makes a double fire a no-op.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const log = createLogger("notify-agenda");
  const sender = getWebPushSender();
  if (!sender) {
    // VAPID keys unset (runbook §1e): a visible "not configured" condition,
    // not a fault — like the Graph/Todoist 503 paths. /health push.lastAgenda
    // staying null is the canary.
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
    const standDown = await standDownIfNotOwner("notify-agenda", ownerId);
    if (standDown) return standDown;
    const result = await runAgendaNotify(ownerId, sender);
    await stampJobRun(ownerId, "notify-agenda");
    log.info("agenda notify finished", { ...result, tally: result.tally });
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    await captureError("notify-agenda", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
