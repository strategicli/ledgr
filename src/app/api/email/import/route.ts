import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { getGraphMailSource } from "@/lib/email/graph-source";
import { runEmailImport } from "@/lib/email/sync";
import { GraphError } from "@/lib/graph/client";
import { captureError, createLogger, errorMessage } from "@/lib/log";

// "Import now" for email-in (slice 26): the user-authed twin of the cron.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  const log = createLogger("email-import-now");
  const source = getGraphMailSource();
  if (!source) {
    log.warn("mail source not configured (GRAPH_* / mailbox UPN unset)");
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId, error: "mail source not configured" },
      { status: 503 }
    );
  }

  try {
    const msgErrors: { messageId: string; message: string }[] = [];
    const result = await runEmailImport(owner.id, source, {
      onError: (messageId, err) => msgErrors.push({ messageId, message: errorMessage(err) }),
    });
    log.info("email import (now) finished", { ...result });
    if (msgErrors.length > 0) {
      await captureError("email-import-now", null, {
        correlationId: log.correlationId,
        message: `${msgErrors.length} message(s) failed to import`,
        detail: { msgErrors },
      });
    }
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    if (err instanceof GraphError && (err.status === 403 || err.status === 404)) {
      log.warn("email import not configured", { detail: err.message });
      return NextResponse.json(
        { ok: false, correlationId: log.correlationId, error: "email import not configured (runbook §1c / §5.3)" },
        { status: 503 }
      );
    }
    await captureError("email-import-now", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
