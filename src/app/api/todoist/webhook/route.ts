import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isTodoistAdapterActive } from "@/lib/tasks/provider";
import { getTodoistClient } from "@/lib/todoist/client";
import { resolveTodoistOwner } from "@/lib/todoist/owner";
import { runTodoistSync } from "@/lib/todoist/sync";
import { captureError, createLogger, errorMessage } from "@/lib/log";

// Todoist webhook (slice 25, PRD §5.2 "webhook preferred"). Todoist signs the
// raw body with the app's client secret (HMAC-SHA256, base64) in the
// X-Todoist-Hmac-SHA256 header — there is no Bearer token, so this route is
// excluded from Clerk in proxy.ts and verifies the signature itself.
//
// Rather than duplicate per-event logic, a verified event triggers one
// idempotent runTodoistSync (the polling engine is the single source of truth;
// the webhook just makes it prompt). Errors are captured but the route still
// returns 200 so Todoist doesn't retry-storm — the cron is the backstop.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function signatureValid(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const log = createLogger("todoist-webhook");
  // Native is the default tasks adapter (ADR-073/081): a webhook that arrives
  // when Todoist isn't active is ignored with 200 (no retry-storm), never synced.
  if (!isTodoistAdapterActive()) {
    return NextResponse.json({ ok: true, skipped: true, adapter: "native" });
  }
  const secret = process.env.TODOIST_CLIENT_SECRET;
  const client = getTodoistClient();

  // Read the raw body once (signature is over the exact bytes).
  const rawBody = await request.text();

  if (!secret || !client) {
    log.warn("Todoist webhook hit but not configured (TODOIST_CLIENT_SECRET / TODOIST_TOKEN unset)");
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }
  if (!signatureValid(rawBody, request.headers.get("x-todoist-hmac-sha256"), secret)) {
    // A bad signature is the one case we reject outright (don't run a sync for
    // a forged call).
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  try {
    const ownerId = await resolveTodoistOwner();
    if (!ownerId) throw new Error("no users row resolves the Todoist owner");
    const result = await runTodoistSync(ownerId, client, {
      onError: (itemId, err) => log.warn("task sync error", { itemId, message: errorMessage(err) }),
    });
    log.info("todoist webhook sync finished", { ...result });
  } catch (err) {
    // Capture, but still 200: Todoist retries non-2xx, and the cron is the
    // backstop. We don't want a retry storm over a transient failure.
    await captureError("todoist-webhook", err, { correlationId: log.correlationId });
  }
  return NextResponse.json({ ok: true });
}
