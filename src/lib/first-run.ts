// The two optional next steps a brand-new local install offers on /setup once
// its owner exists (ADR-282): restore from a backup, and connect with
// Tailscale. This file is the restore's app half: the files it shares with
// the supervisor, and the "is there anything here to lose?" count.
//
// The file names are mirrored in supervisor/lib.mjs (restoreSignalPath,
// restoreUploadPath, restoreResultPath); scripts/verify-restore-from-setup.mts checks
// the two agree.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";

export const RESTORE_REQUEST_FILE = "restore-requested";
export const RESTORE_RESULT_FILE = "restore-result.json";
export const RESTORE_UPLOAD = join("restore", "incoming.dump");
export const RESTORE_TICKET = join("restore", "upload-ticket.json");

/** The data folder of a copy run by the supervisor on this computer, else null. */
export function localDataDir(): string | null {
  const dir = process.env.LEDGR_SUPERVISOR_DIR;
  return dir && !process.env.VERCEL_ENV ? dir : null;
}

/** Every item this owner has, Trash included. Zero means a restore loses nothing. */
export async function ownerItemCount(ownerId: string): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(items).where(eq(items.ownerId, ownerId));
  return Number(row?.n ?? 0);
}

/** How long /setup keeps mentioning a finished restore. */
const RESULT_SHOWN_MS = 60 * 60_000;

/** The supervisor's last restore outcome, while it is still news. */
export function readRestoreResult(dir: string, nowMs = Date.now()): { ok: boolean; detail: string | null } | null {
  const p = join(dir, RESTORE_RESULT_FILE);
  if (!existsSync(p)) return null;
  try {
    const r = JSON.parse(readFileSync(p, "utf8")) as { ok?: unknown; detail?: unknown; at?: unknown };
    const at = Date.parse(String(r.at));
    if (!Number.isFinite(at) || nowMs - at > RESULT_SHOWN_MS) return null;
    return { ok: r.ok === true, detail: typeof r.detail === "string" ? r.detail : null };
  } catch {
    return null;
  }
}
