// This install's sign-in state (ADR-274): the one signin_install row, read
// through a short in-process cache so the front gate can consult it without a
// database round trip on every request. Kept free of next/headers so the proxy
// can import it.
//
// Per install by design, never synced or copied: which method this copy uses,
// the secret its session cookies are signed with, and the attempt counter.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { signinInstall } from "@/db/schema";
import { newCookieSecret } from "./builtin-core";

export type InstallState = {
  method: string | null;
  cookieSecret: string;
  failedCount: number;
  failedAt: Date | null;
};

const TTL_MS = 15_000;
let cached: { at: number; value: InstallState } | null = null;

async function load(): Promise<InstallState> {
  const db = getDb();
  const read = () =>
    db
      .select({
        method: signinInstall.method,
        cookieSecret: signinInstall.cookieSecret,
        failedCount: signinInstall.failedCount,
        failedAt: signinInstall.failedAt,
      })
      .from(signinInstall)
      .where(eq(signinInstall.id, 1));
  let [row] = await read();
  if (!row) {
    // First read on this install: mint its cookie secret. ON CONFLICT covers two
    // requests racing to create it; both then read the one that won.
    await db.insert(signinInstall).values({ id: 1, cookieSecret: newCookieSecret() }).onConflictDoNothing();
    [row] = await read();
  }
  return row;
}

/** The install row (created on first read). `fresh` skips the cache. */
export async function readInstall(opts: { fresh?: boolean } = {}): Promise<InstallState> {
  if (!opts.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await load();
  cached = { at: Date.now(), value };
  return value;
}

/**
 * The same, but never throws: the last value this process saw, or null when it
 * has never managed to read one (no database configured, a fresh clone).
 */
export async function readInstallSafe(): Promise<InstallState | null> {
  try {
    return await readInstall();
  } catch {
    return cached?.value ?? null;
  }
}

/** Forget the cached row after a write, so this process acts on it at once. */
export function invalidateInstallCache(): void {
  cached = null;
}

/**
 * Password sign-in is never used on a Vercel PREVIEW deployment. A preview runs
 * branch code; if it ever shares a database with production, this keeps it from
 * reading or changing that install's sign-in state, and from signing anyone in
 * to production data under a preview address.
 */
export function builtinAllowedHere(): boolean {
  return process.env.VERCEL_ENV !== "preview";
}

/**
 * The method this copy uses: "builtin" or null (the default: Clerk where it is
 * configured, else the local no-login mode). LEDGR_SIGNIN_METHOD is the
 * documented EMERGENCY override only (runbook): "builtin" or "default". The
 * normal way to switch is User Settings.
 */
export function effectiveMethod(state: Pick<InstallState, "method"> | null): "builtin" | null {
  const override = process.env.LEDGR_SIGNIN_METHOD;
  if (override === "builtin") return "builtin";
  if (override === "default") return null;
  return state?.method === "builtin" ? "builtin" : null;
}

/** Is password sign-in switched on for this copy? null when unknown. */
export async function builtinOnState(): Promise<boolean | null> {
  if (!builtinAllowedHere()) return false;
  const state = await readInstallSafe();
  if (!state) return process.env.LEDGR_SIGNIN_METHOD === "builtin" ? true : null;
  return effectiveMethod(state) === "builtin";
}

export async function setMethod(method: "builtin" | null): Promise<void> {
  await readInstall({ fresh: true }); // make sure the row exists
  await getDb().update(signinInstall).set({ method }).where(eq(signinInstall.id, 1));
  invalidateInstallCache();
}
