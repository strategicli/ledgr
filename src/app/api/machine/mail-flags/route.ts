import { NextResponse } from "next/server";
import { verifyMachineRequest } from "@/lib/auth/credentials";
import { captureError, createLogger, errorMessage } from "@/lib/log";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { moduleIsOn } from "@/lib/modules/gate";
import { clearFlagsForFinishedTasks } from "@/modules/mail/lib/links";
import { mailAvailable } from "@/modules/mail/manifest";

// Mail flags in step with tasks (phase 4): a task made from an email flagged
// it; once the task is done, this unflags the email. A shared job, so each
// install runs it for itself, and only the hub can actually do anything
// (the cloud copy answers with a clean skip). Same pattern as /snapshot.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await verifyMachineRequest(request.headers.get("authorization"), "cron");
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!mailAvailable()) return NextResponse.json({ ok: true, skipped: "mail runs only on the hub" });
  const ownerId = await resolveMachineOwner();
  if (!ownerId) return NextResponse.json({ ok: true, skipped: "no owner" });
  if (!(await moduleIsOn(ownerId, "mail"))) return NextResponse.json({ ok: true, skipped: "the mail module is off" });

  const log = createLogger("mail-flags");
  try {
    const result = await clearFlagsForFinishedTasks(ownerId);
    if (result.failed) {
      await captureError("mail-flags", null, {
        correlationId: log.correlationId,
        message: `${result.failed} email flag(s) could not be cleared`,
      });
    }
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    log.error("mail flag sync failed", { error: errorMessage(err) });
    return NextResponse.json({ ok: false, correlationId: log.correlationId, error: errorMessage(err) }, { status: 500 });
  }
}
