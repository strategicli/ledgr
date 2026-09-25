// This computer's own Tailscale switch, and the nudge that tells the supervisor
// to act on it now rather than within the minute.
//
// `job_state` for the same reason as `snapshots:enabled` (ADR-222): it is
// outside the synced set, so one computer's choice never reaches another, and
// it is read fresh every time, so it needs no restart. Absent = off.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState } from "@/db/schema";

const KEY = "tailscale:enabled";

export async function readTailscaleEnabled(): Promise<boolean> {
  const rows = await getDb().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  return (rows[0]?.value as { enabled?: unknown } | undefined)?.enabled === true;
}

export async function writeTailscaleEnabled(enabled: boolean): Promise<void> {
  const value = { enabled };
  await getDb()
    .insert(jobState)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: new Date() } });
}

/**
 * Drop the signal file the supervisor polls every 2s (the Update and Startup
 * door). `logout` also signs this computer's node out and forgets its keys.
 */
export async function signalSupervisor(supervisorDir: string, opts: { logout?: boolean } = {}): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await writeFile(join(supervisorDir, "tailscale-requested"), JSON.stringify({ logout: !!opts.logout }) + "\n", "utf8");
}
