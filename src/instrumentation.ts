// Next.js instrumentation hook: runs once per server process start. The only
// job here is arming the sync loop on local peers (plan decision 11 — the
// loop lives in the app process, no second daemon). Guarded twice: nodejs
// runtime only (never edge/build), and only when LEDGR_SYNC_HUBS is set, so
// the cloud hub and any instance not opted into sync start nothing.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.LEDGR_SYNC_HUBS) return;
  const { startSyncLoop } = await import("@/lib/sync/client");
  startSyncLoop();
}
