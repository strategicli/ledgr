import { NextResponse } from "next/server";
import { verifyMachineToken } from "@/lib/auth/machine";
import { captureError, createLogger } from "@/lib/log";
import { purgeExpiredTrash } from "@/lib/item-mutations";
import { purgeExpiredAudio } from "@/lib/attachments";
import { purgeArchivedNotifications } from "@/lib/notifications";

// Daily Trash purge (vercel.json cron). Vercel sends GET with
// `Authorization: Bearer $CRON_SECRET`; CRON_SECRET holds a raw machine
// token with the cron scope, so the platform cron walks through the same
// door as any other machine caller (ADR-005, runbook.md §3). Also reclaims
// expired audio (meeting recording v1b, ADR-089): once a transcript is
// produced, the audio is stamped purge_after now()+30d and removed here.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = verifyMachineToken(
    request.headers.get("authorization"),
    "cron"
  );
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const log = createLogger("purge");
  try {
    const result = await purgeExpiredTrash();
    const audio = await purgeExpiredAudio();
    // 30-day purge of archived notifications (ADR-129), matching Trash's window.
    const notifications = await purgeArchivedNotifications();
    log.info("purge run finished", { ...result, ...audio, ...notifications });
    return NextResponse.json({
      ok: true,
      correlationId: log.correlationId,
      ...result,
      ...audio,
      ...notifications,
    });
  } catch (err) {
    // No silent failures: cron errors land in error_log and surface
    // through /health.
    await captureError("purge", err, { correlationId: log.correlationId });
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId },
      { status: 500 }
    );
  }
}
