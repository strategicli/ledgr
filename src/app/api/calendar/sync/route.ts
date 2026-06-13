import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { getGraphCalendarSource } from "@/lib/calendar/graph-source";
import { runCalendarSync } from "@/lib/calendar/sync";
import { GraphError } from "@/lib/graph/client";
import { applyMatchersToMeeting } from "@/lib/matchers/engine";
import { captureError, createLogger, errorMessage } from "@/lib/log";

// "Sync now" (slice 22, PRD §5.1): the user-authed twin of the GitHub Actions
// cron. Runs the same engine against the signed-in user's data; Clerk protects
// the route, requireOwner scopes it. Lets Brandon pull fresh events on demand
// instead of waiting for the 6h poll.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  const log = createLogger("calendar-sync-now");
  const source = getGraphCalendarSource();
  if (!source) {
    log.warn("calendar source not configured (GRAPH_* / mailbox UPN unset)");
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId, error: "calendar source not configured" },
      { status: 503 }
    );
  }

  try {
    const eventErrors: { eventId: string; message: string }[] = [];
    const result = await runCalendarSync(owner.id, source, {
      onError: (eventId, err) => eventErrors.push({ eventId, message: errorMessage(err) }),
      onCreated: async (itemId, event) => {
        try {
          await applyMatchersToMeeting(owner.id, itemId, event);
        } catch (err) {
          log.warn("matcher application failed", { itemId, message: errorMessage(err) });
        }
      },
    });
    log.info("calendar sync (now) finished", { ...result });
    if (eventErrors.length > 0) {
      await captureError("calendar-sync-now", null, {
        correlationId: log.correlationId,
        message: `${eventErrors.length} event(s) failed to sync`,
        detail: { eventErrors },
      });
    }
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    if (err instanceof GraphError && err.status === 403) {
      log.warn("calendar read forbidden (403): Calendars.Read / Application Access Policy not in place (runbook §1c)");
      return NextResponse.json(
        { ok: false, correlationId: log.correlationId, error: "calendar access not configured (runbook §1c)" },
        { status: 503 }
      );
    }
    await captureError("calendar-sync-now", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
