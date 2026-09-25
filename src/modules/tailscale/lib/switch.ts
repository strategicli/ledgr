// This computer's own Tailscale switches, and the nudge that tells the
// supervisor to act on them now rather than within the minute.
//
// `job_state` for the same reason as `snapshots:enabled` (ADR-222): it is
// outside the synced set, so one computer's choice never reaches another, and
// it is read fresh every time, so it needs no restart. Absent = off.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState } from "@/db/schema";
import { builtinOnState } from "@/lib/auth/builtin-state";
import { isClerkConfigured } from "@/lib/auth/keyless";

// Private access on this computer, and public access (Funnel, ADR-278) on top.
const ENABLED = "tailscale:enabled";
const FUNNEL = "tailscale:funnel";

async function readFlag(key: string): Promise<boolean> {
  const rows = await getDb().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key));
  return (rows[0]?.value as { enabled?: unknown } | undefined)?.enabled === true;
}

async function writeFlag(key: string, enabled: boolean): Promise<void> {
  const value = { enabled };
  await getDb()
    .insert(jobState)
    .values({ key, value })
    .onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: new Date() } });
}

export const readTailscaleEnabled = () => readFlag(ENABLED);
export const writeTailscaleEnabled = (on: boolean) => writeFlag(ENABLED, on);
export const readFunnelWanted = () => readFlag(FUNNEL);
export const writeFunnelWanted = (on: boolean) => writeFlag(FUNNEL, on);

/**
 * Does this copy make everyone sign in? Clerk keys, or the built-in password
 * switched on. Public access is refused without it (ADR-278); "unknown" counts
 * as no. The supervisor checks the same thing on its own side.
 */
export async function signinRequired(): Promise<boolean> {
  return isClerkConfigured() || (await builtinOnState()) === true;
}

/**
 * Drop the signal file the supervisor polls every 2s (the Update and Startup
 * door). `logout` also signs this computer's node out and forgets its keys;
 * `recheck` retries public access after the owner fixed their tailnet.
 */
export async function signalSupervisor(
  supervisorDir: string,
  opts: { logout?: boolean; recheck?: boolean } = {}
): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await writeFile(
    join(supervisorDir, "tailscale-requested"),
    JSON.stringify({ logout: !!opts.logout, recheck: !!opts.recheck }) + "\n",
    "utf8"
  );
}
