import { NextResponse } from "next/server";
import { verifyMachineToken } from "@/lib/auth/machine";
import { getDb } from "@/db";
import { errorLog } from "@/db/schema";
import { purgeExpiredTrash } from "@/lib/items";

// Daily Trash purge (vercel.json cron). Vercel sends GET with
// `Authorization: Bearer $CRON_SECRET`; CRON_SECRET holds a raw machine
// token with the cron scope, so the platform cron walks through the same
// door as any other machine caller (ADR-005, runbook.md §3).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = verifyMachineToken(
    request.headers.get("authorization"),
    "cron"
  );
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const correlationId = crypto.randomUUID();
  try {
    const result = await purgeExpiredTrash();
    console.log(
      JSON.stringify({ source: "purge", correlationId, ...result })
    );
    return NextResponse.json({ ok: true, correlationId, ...result });
  } catch (err) {
    // No silent failures: cron errors land in error_log and surface later
    // through /health and the UI.
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ source: "purge", correlationId, message }));
    try {
      await getDb()
        .insert(errorLog)
        .values({
          correlationId,
          source: "purge",
          message,
          detail:
            err instanceof Error && err.stack ? { stack: err.stack } : null,
        });
    } catch {
      // DB down is the likely cause; the console line above is the record.
    }
    return NextResponse.json(
      { ok: false, correlationId },
      { status: 500 }
    );
  }
}
