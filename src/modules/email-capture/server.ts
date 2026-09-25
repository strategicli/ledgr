// Server-only slots for the email capture module (ADR-272 step 4). Imported for
// effect by src/lib/modules/server-slots.ts, never by the pure path.
import { emailCaptureModule } from "@/modules/email-capture/manifest";

// The last import run and the last clean one. health.ts copies them into the
// lastEmailImportAt / lastEmailRunAt keys the weekly check reads.
if (!emailCaptureModule.healthCheck) {
  emailCaptureModule.healthCheck = async () => {
    const { getEmailState } = await import("@/modules/email-capture/lib/sync");
    const s = await getEmailState();
    return { lastSyncAt: s?.lastSuccessAt ?? null, lastRunAt: s?.lastRunAt ?? null };
  };
}
