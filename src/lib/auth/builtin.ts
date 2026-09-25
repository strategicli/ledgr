// Built-in owner sign-in, the server half (ADR-274): sessions, the password and
// recovery codes on the users row, the attempt counter, and the provider that
// plugs into the same one-function AuthProvider seam as Clerk.
//
// Nothing here logs a password, a recovery code, a session code or a cookie
// value (checked by scripts/verify-builtin-auth.mts).
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { signinInstall, signinSessions, users } from "@/db/schema";
import {
  generateRecoveryCodes,
  hashPassword,
  hashRecoveryCode,
  lockoutRemainingMs,
  matchRecoveryCode,
  newCookieSecret,
  newSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  sessionCookieOptions,
  sessionLabel,
  signSessionCookie,
  verifySessionCookie,
} from "./builtin-core";
import { builtinAllowedHere, builtinOnState, invalidateInstallCache, readInstall } from "./builtin-state";
import { clerkAuthProvider } from "./clerk";
import { isClerkConfigured } from "./keyless";
import { hashToken } from "./machine";
import type { AuthProvider } from "./types";

// ── The owner whose password this is ────────────────────────────────────────

export type PasswordOwner = {
  id: string;
  email: string;
  passwordHash: string;
  recoveryCodes: string[];
};

/**
 * The one users row holding a password. A password is only ever set by the
 * signed-in owner on their own row, so on a single-owner install this is that
 * owner; two rows with passwords is a state this build refuses to guess about.
 */
export async function passwordOwner(): Promise<PasswordOwner | null> {
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      recoveryCodes: users.recoveryCodes,
    })
    .from(users)
    .where(isNotNull(users.passwordHash))
    .limit(2);
  if (rows.length !== 1) return null;
  const r = rows[0];
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.passwordHash as string,
    recoveryCodes: Array.isArray(r.recoveryCodes) ? r.recoveryCodes : [],
  };
}

export type SigninStatus = { passwordSet: boolean; codesLeft: number };

export async function signinStatus(ownerId: string): Promise<SigninStatus> {
  const [row] = await getDb()
    .select({ passwordHash: users.passwordHash, recoveryCodes: users.recoveryCodes })
    .from(users)
    .where(eq(users.id, ownerId));
  return {
    passwordSet: !!row?.passwordHash,
    codesLeft: Array.isArray(row?.recoveryCodes) ? row.recoveryCodes.length : 0,
  };
}

export async function setPassword(ownerId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await getDb().update(users).set({ passwordHash }).where(eq(users.id, ownerId));
}

/** A new kit of ten codes. Replaces (voids) every earlier code. Returns the codes, once. */
export async function issueRecoveryKit(ownerId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await getDb()
    .update(users)
    .set({ recoveryCodes: codes.map(hashRecoveryCode) })
    .where(eq(users.id, ownerId));
  return codes;
}

async function storedCodes(ownerId: string): Promise<string[]> {
  const [row] = await getDb()
    .select({ recoveryCodes: users.recoveryCodes })
    .from(users)
    .where(eq(users.id, ownerId));
  return Array.isArray(row?.recoveryCodes) ? row.recoveryCodes : [];
}

/** Does this code belong to the current kit? Does not use it up (the "type one back" check). */
export async function recoveryCodeMatches(ownerId: string, code: unknown): Promise<boolean> {
  return matchRecoveryCode(code, await storedCodes(ownerId)) >= 0;
}

/**
 * Use a code up. The write is conditional on the array being unchanged, so two
 * simultaneous uses of one code cannot both succeed on this copy. (Another copy
 * may still accept it until sync carries the removal, which the design accepts.)
 */
export async function consumeRecoveryCode(ownerId: string, code: unknown): Promise<boolean> {
  const before = await storedCodes(ownerId);
  const i = matchRecoveryCode(code, before);
  if (i < 0) return false;
  const after = before.filter((_, j) => j !== i);
  const res = await getDb()
    .update(users)
    .set({ recoveryCodes: after })
    .where(and(eq(users.id, ownerId), sql`${users.recoveryCodes} = ${JSON.stringify(before)}::jsonb`))
    .returning({ id: users.id });
  return res.length === 1;
}

// ── Slowing down guessing ───────────────────────────────────────────────────

/**
 * Take one attempt from this install's budget BEFORE checking the password, so
 * parallel guesses cannot all slip in before the counter moves: the write is
 * conditional on the count it read, so attempts are effectively one at a time.
 */
export async function claimAttempt(): Promise<{ ok: true } | { ok: false; retryInSec: number }> {
  const s = await readInstall({ fresh: true });
  const wait = lockoutRemainingMs(s.failedCount, s.failedAt, Date.now());
  if (wait > 0) return { ok: false, retryInSec: Math.ceil(wait / 1000) };
  const res = await getDb()
    .update(signinInstall)
    .set({ failedCount: s.failedCount + 1, failedAt: new Date() })
    .where(and(eq(signinInstall.id, 1), eq(signinInstall.failedCount, s.failedCount)))
    .returning({ id: signinInstall.id });
  invalidateInstallCache();
  if (res.length === 0) return { ok: false, retryInSec: 2 };
  return { ok: true };
}

/** A successful sign-in clears the counter. */
export async function clearAttempts(): Promise<void> {
  await getDb().update(signinInstall).set({ failedCount: 0, failedAt: null }).where(eq(signinInstall.id, 1));
  invalidateInstallCache();
}

// ── Sessions ─────────────────────────────────────────────────────────────────

type CurrentSession = { sessionId: string; ownerId: string };

const HOUR_MS = 60 * 60 * 1000;

/**
 * The built-in session this request carries, or null. No cookie means no
 * database work at all, which is what keeps a Clerk-only install unchanged.
 */
export const currentBuiltinSession = cache(async (): Promise<CurrentSession | null> => {
  if (!builtinAllowedHere()) return null;
  // Not wrapped in try/catch: reading cookies is what marks a page as
  // per-request, and swallowing that signal would let Next prerender it.
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const state = await readInstall();
  const v = verifySessionCookie(raw, state.cookieSecret, Date.now());
  if (!v) return null;
  const db = getDb();
  const [s] = await db
    .select({ id: signinSessions.id, ownerId: signinSessions.ownerId, lastSeenAt: signinSessions.lastSeenAt })
    .from(signinSessions)
    .where(eq(signinSessions.tokenHash, hashToken(v.token)));
  if (!s) return null;
  const idle = Date.now() - s.lastSeenAt.getTime();
  if (idle > SESSION_MAX_AGE_SEC * 1000) {
    await db.delete(signinSessions).where(eq(signinSessions.id, s.id));
    return null;
  }
  if (idle > HOUR_MS) {
    // Renewal: a session lives while it's used within 90 days.
    await db.update(signinSessions).set({ lastSeenAt: new Date() }).where(eq(signinSessions.id, s.id)).catch(() => {});
  }
  return { sessionId: s.id, ownerId: s.ownerId };
});

async function clearCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

/**
 * Sign this browser in: always a NEW random session code (never reuse one the
 * browser already had), and the old one, if any, is ended. Server actions and
 * route handlers only (it sets a cookie).
 */
export async function startSession(ownerId: string): Promise<void> {
  const old = await currentBuiltinSession().catch(() => null);
  const db = getDb();
  if (old) await db.delete(signinSessions).where(eq(signinSessions.id, old.sessionId));
  const token = newSessionToken();
  const ua = (await headers()).get("user-agent");
  await db.insert(signinSessions).values({ ownerId, tokenHash: hashToken(token), label: sessionLabel(ua) });
  const state = await readInstall();
  (await cookies()).set(
    SESSION_COOKIE,
    signSessionCookie(token, Math.floor(Date.now() / 1000), state.cookieSecret),
    sessionCookieOptions()
  );
}

/** Sign out: end this browser's session. */
export async function endThisSession(): Promise<void> {
  const s = await currentBuiltinSession().catch(() => null);
  if (s) await getDb().delete(signinSessions).where(eq(signinSessions.id, s.sessionId));
  await clearCookie();
}

/**
 * Sign out everywhere, on this copy: every session row goes, and the cookie
 * secret is replaced, so no cookie signed before this moment passes the gate.
 */
export async function endAllSessions(ownerId: string): Promise<void> {
  const db = getDb();
  await db.delete(signinSessions).where(eq(signinSessions.ownerId, ownerId));
  await readInstall({ fresh: true });
  await db.update(signinInstall).set({ cookieSecret: newCookieSecret() }).where(eq(signinInstall.id, 1));
  invalidateInstallCache();
  await clearCookie();
}

export type SessionSummary = { id: string; label: string; createdAt: string; lastSeenAt: string; current: boolean };

export async function listSessions(ownerId: string): Promise<SessionSummary[]> {
  const mine = await currentBuiltinSession().catch(() => null);
  const rows = await getDb()
    .select({
      id: signinSessions.id,
      label: signinSessions.label,
      createdAt: signinSessions.createdAt,
      lastSeenAt: signinSessions.lastSeenAt,
    })
    .from(signinSessions)
    .where(eq(signinSessions.ownerId, ownerId))
    .orderBy(desc(signinSessions.lastSeenAt));
  return rows.map((r) => ({
    id: r.id,
    label: r.label ?? "A browser",
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    current: r.id === mine?.sessionId,
  }));
}

export async function revokeSession(ownerId: string, id: string): Promise<boolean> {
  const res = await getDb()
    .delete(signinSessions)
    .where(and(eq(signinSessions.id, id), eq(signinSessions.ownerId, ownerId)))
    .returning({ id: signinSessions.id });
  return res.length === 1;
}

/**
 * Does this request carry a Clerk sign-in that belongs to this owner? The guard
 * on switching a copy back to Clerk: only once this browser has proved Clerk
 * works for you.
 */
export async function clerkLinkedHere(ownerId: string): Promise<boolean> {
  if (!isClerkConfigured()) return false;
  try {
    const u = await clerkAuthProvider.getCurrentUser();
    if (!u) return false;
    const [row] = await getDb().select({ clerkId: users.clerkId }).from(users).where(eq(users.id, ownerId));
    return !!row?.clerkId && row.clerkId === u.externalId;
  } catch (err) {
    unstable_rethrow(err);
    return false;
  }
}

// ── The provider ─────────────────────────────────────────────────────────────

/**
 * Wraps whichever provider the env chose (Clerk, the local no-login mode, the
 * dev stand-in, or nobody). A valid built-in session wins; otherwise the
 * wrapped provider answers, EXCEPT the local no-login mode, which closes the
 * moment this copy switches to password sign-in (and fails closed if that
 * switch can't be read). Clerk stays a second open door on purpose: the design
 * keeps both methods working so a wrong flip never locks the owner out.
 */
export function withBuiltin(fallback: AuthProvider, fallbackIsNoLogin: boolean): AuthProvider {
  return {
    async getCurrentUser() {
      let s: CurrentSession | null = null;
      try {
        s = await currentBuiltinSession();
      } catch (err) {
        unstable_rethrow(err); // Next's own control flow (dynamic rendering, redirects)
        // A database hiccup reads as "no built-in session"; the wrapped
        // provider still answers, and the no-login mode below fails closed.
      }
      if (s) return { externalId: `builtin:${s.ownerId}`, email: null, ownerId: s.ownerId };
      if (fallbackIsNoLogin && (await builtinOnState()) !== false) return null;
      return fallback.getCurrentUser();
    },
  };
}
