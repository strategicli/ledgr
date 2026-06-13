import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { getTodoistClient } from "@/lib/todoist/client";
import { runTodoistSync } from "@/lib/todoist/sync";
import { captureError, createLogger, errorMessage } from "@/lib/log";

// "Sync now" for Todoist (slice 25): the user-authed twin of the cron. Runs the
// same engine against the signed-in user's tasks.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  const log = createLogger("todoist-sync-now");
  const client = getTodoistClient();
  if (!client) {
    log.warn("Todoist not configured (TODOIST_TOKEN unset)");
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId, error: "Todoist not configured" },
      { status: 503 }
    );
  }

  try {
    const taskErrors: { itemId: string; message: string }[] = [];
    const result = await runTodoistSync(owner.id, client, {
      onError: (itemId, err) => taskErrors.push({ itemId, message: errorMessage(err) }),
    });
    log.info("todoist sync (now) finished", { ...result });
    if (taskErrors.length > 0) {
      await captureError("todoist-sync-now", null, {
        correlationId: log.correlationId,
        message: `${taskErrors.length} task(s) failed to sync`,
        detail: { taskErrors },
      });
    }
    return NextResponse.json({ ok: true, correlationId: log.correlationId, ...result });
  } catch (err) {
    await captureError("todoist-sync-now", err, { correlationId: log.correlationId });
    return NextResponse.json({ ok: false, correlationId: log.correlationId }, { status: 500 });
  }
}
