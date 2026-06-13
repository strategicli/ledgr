import { NextResponse } from "next/server";
import { verifyMachineToken } from "@/lib/auth/machine";
import { getGraphCalendarSource } from "@/lib/calendar/graph-source";
import { resolveMailboxOwner } from "@/lib/calendar/owner";
import { runCalendarSync } from "@/lib/calendar/sync";
import { getGraphMailboxUpn, GraphError } from "@/lib/graph/client";
import { applyMatchersToMeeting } from "@/lib/matchers/engine";
import { captureError, createLogger, errorMessage } from "@/lib/log";

// Scheduled calendar sync (slice 22, PRD §5.1). Sub-daily, so it runs from
// GitHub Actions (.github/workflows/calendar-sync.yml) hitting this endpoint
// with a cron-scoped machine token — the same auth door as the purge/export
// crons. The user-authed "sync now" twin is POST /api/calendar/sync.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const identity = verifyMachineToken(request.headers.get("authorization"), "cron");
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const log = createLogger("calendar-sync");
  const source = getGraphCalendarSource();
  const upn = getGraphMailboxUpn();
  if (!source || !upn) {
    log.warn("calendar source not configured (GRAPH_* / mailbox UPN unset)");
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId, error: "calendar source not configured" },
      { status: 503 }
    );
  }

  try {
    const ownerId = await resolveMailboxOwner(upn);
    if (!ownerId) throw new Error(`no users row matches mailbox UPN ${upn}`);
    const eventErrors: { eventId: string; message: string }[] = [];
    const result = await runCalendarSync(ownerId, source, {
      onError: (eventId, err) => eventErrors.push({ eventId, message: errorMessage(err) }),
      // Run the matchers on each new meeting; a matcher failure is a warning,
      // never a sync failure (the meeting was created either way).
      onCreated: async (itemId, event) => {
        try {
          await applyMatchersToMeeting(ownerId, itemId, event);
        } catch (err) {
          log.warn("matcher application failed", { itemId, message: errorMessage(err) });
        }
      },
    });
    log.info("calendar sync finished", { ...result });
    if (eventErrors.length > 0) {
      await captureError("calendar-sync", null, {
        correlationId: log.correlationId,
        message: `${eventErrors.length} event(s) failed to sync`,
        detail: { eventErrors },
      });
    }
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    // A 403 means Calendars.Read / the Application Access Policy isn't in place
    // yet (runbook §1c): a visible "not configured" condition, not a fault —
    // report it as 503 and warn, so error_log isn't spammed every 6h before
    // setup. /health calendar lastSuccessAt staying null is the canary.
    if (err instanceof GraphError && err.status === 403) {
      log.warn("calendar read forbidden (403): Calendars.Read / Application Access Policy not in place (runbook §1c)");
      return NextResponse.json(
        { ok: false, correlationId: log.correlationId, error: "calendar access not configured (runbook §1c)" },
        { status: 503 }
      );
    }
    await captureError("calendar-sync", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
