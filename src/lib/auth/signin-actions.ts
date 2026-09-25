"use server";
// Server actions for the built-in password sign-in (ADR-274): the sign-in page,
// the Sign-in section of User Settings, and the reset page at the machine.
//
// Server actions carry Next's own same-origin check (the Origin header must
// match the host), which with the SameSite=Lax cookie is the cross-site
// protection the design names. Every input is re-validated here because an
// action is a public entry point. Nothing here logs a secret.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { resolveOwner } from "@/lib/owner";
import { claimFirstOwner, resolveInstanceOwner } from "@/lib/instance-owner";
import {
  isLoopbackHost,
  passwordProblem,
  RESET_TICKET_FILE,
  resetTicketValid,
  safeRedirect,
  verifyPassword,
} from "./builtin-core";
import { builtinAllowedHere, setMethod } from "./builtin-state";
import {
  claimAttempt,
  clearAttempts,
  clerkLinkedHere,
  consumeRecoveryCode,
  endAllSessions,
  endThisSession,
  issueRecoveryKit,
  passwordOwner,
  recoveryCodeMatches,
  revokeSession,
  setPassword,
  signinStatus,
  startSession,
} from "./builtin";
import { chooseFromProcessEnv } from "./local";
import { isClerkConfigured } from "./keyless";

export type FormState = { error?: string; notice?: string } | null;

function waitText(sec: number): string {
  return sec < 90 ? `${sec} seconds` : `${Math.ceil(sec / 60)} minutes`;
}

const PREVIEW_OFF = "Password sign-in is turned off on preview deployments.";

// ── The sign-in page ─────────────────────────────────────────────────────────

export async function signInWithPassword(_prev: FormState, form: FormData): Promise<FormState> {
  if (!builtinAllowedHere()) return { error: PREVIEW_OFF };
  const owner = await passwordOwner();
  if (!owner) return { error: "No password is set for this copy of Ledgr yet." };
  const claim = await claimAttempt();
  if (!claim.ok) return { error: `Too many tries. Wait ${waitText(claim.retryInSec)}, then try again.` };
  const password = form.get("password");
  if (typeof password !== "string" || !(await verifyPassword(password, owner.passwordHash))) {
    return { error: "That password isn't right." };
  }
  await clearAttempts();
  await startSession(owner.id);
  redirect(safeRedirect(form.get("redirect_url")));
}

export async function signInWithRecoveryCode(_prev: FormState, form: FormData): Promise<FormState> {
  if (!builtinAllowedHere()) return { error: PREVIEW_OFF };
  const owner = await passwordOwner();
  if (!owner) return { error: "No password is set for this copy of Ledgr yet." };
  const claim = await claimAttempt();
  if (!claim.ok) return { error: `Too many tries. Wait ${waitText(claim.retryInSec)}, then try again.` };
  if (!(await consumeRecoveryCode(owner.id, form.get("code")))) {
    return { error: "That recovery code isn't right, or it was already used." };
  }
  await clearAttempts();
  await startSession(owner.id);
  // Straight to the place to set a new password.
  redirect("/settings?recovered=1#sign-in");
}

// ── User Settings → Sign-in ─────────────────────────────────────────────────

export type SettingsResult = { ok: true; kit?: string[]; notice?: string } | { ok: false; error: string };

async function ownerOrError() {
  const owner = await resolveOwner();
  if (!owner) return null;
  return owner;
}

/**
 * Set or change the password. A signed-in device needs no old password (the
 * design's first recovery path). If there are no recovery codes yet, the first
 * kit comes back with it.
 */
export async function setOwnerPassword(password: string, confirm: string): Promise<SettingsResult> {
  if (!builtinAllowedHere()) return { ok: false, error: PREVIEW_OFF };
  const owner = await ownerOrError();
  if (!owner) return { ok: false, error: "Not signed in." };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };
  // One password per install: sign-in checks the single row holding one.
  const holders = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(isNotNull(users.passwordHash));
  if (holders.some((r) => r.id !== owner.id)) {
    return { ok: false, error: "Another account on this copy already has a password." };
  }
  const before = await signinStatus(owner.id);
  await setPassword(owner.id, password);
  const kit = before.codesLeft === 0 ? await issueRecoveryKit(owner.id) : undefined;
  return { ok: true, kit, notice: before.passwordSet ? "Password changed." : "Password set." };
}

/** A new kit of ten codes; the old codes stop working. */
export async function newRecoveryKit(): Promise<SettingsResult> {
  if (!builtinAllowedHere()) return { ok: false, error: PREVIEW_OFF };
  const owner = await ownerOrError();
  if (!owner) return { ok: false, error: "Not signed in." };
  return { ok: true, kit: await issueRecoveryKit(owner.id) };
}

/** The kit's "type one back" check. Does not use the code up. */
export async function checkRecoveryCode(code: string): Promise<SettingsResult> {
  const owner = await ownerOrError();
  if (!owner) return { ok: false, error: "Not signed in." };
  return (await recoveryCodeMatches(owner.id, code))
    ? { ok: true }
    : { ok: false, error: "That code doesn't match the kit above. Type one of the ten codes." };
}

/**
 * Switch THIS copy to password sign-in. Only with proof it works: the password
 * typed now, and one recovery code typed back (proving the kit was saved). This
 * browser is signed in with the password on the way, so the switch never
 * strands the person making it.
 */
export async function switchToPassword(password: string, code: string): Promise<SettingsResult> {
  if (!builtinAllowedHere()) return { ok: false, error: PREVIEW_OFF };
  const owner = await ownerOrError();
  if (!owner) return { ok: false, error: "Not signed in." };
  const holder = await passwordOwner();
  if (!holder || holder.id !== owner.id) return { ok: false, error: "Set a password first." };
  if (holder.recoveryCodes.length === 0) return { ok: false, error: "Make a recovery kit first." };
  const claim = await claimAttempt();
  if (!claim.ok) return { ok: false, error: `Too many tries. Wait ${waitText(claim.retryInSec)}, then try again.` };
  if (typeof password !== "string" || !(await verifyPassword(password, holder.passwordHash))) {
    return { ok: false, error: "That password isn't right." };
  }
  if (!(await recoveryCodeMatches(owner.id, code))) {
    return { ok: false, error: "That recovery code doesn't match your kit. Type one of the ten codes you saved." };
  }
  await clearAttempts();
  await setMethod("builtin");
  await startSession(owner.id);
  return { ok: true, notice: "This copy of Ledgr now signs in with your password." };
}

/**
 * Switch THIS copy back to its default: Clerk where Clerk is configured (only
 * once this browser has a Clerk sign-in linked to this owner), or the local
 * no-login mode on a local install without Clerk.
 */
export async function switchToDefault(): Promise<SettingsResult> {
  const owner = await ownerOrError();
  if (!owner) return { ok: false, error: "Not signed in." };
  if (isClerkConfigured()) {
    if (!(await clerkLinkedHere(owner.id))) {
      return {
        ok: false,
        error: "Sign in with Clerk in this browser first (Sign-in page → Sign in with Clerk instead), then switch.",
      };
    }
  } else if (chooseFromProcessEnv() !== "local") {
    return { ok: false, error: "This copy has no other way to sign in, so it stays on password sign-in." };
  }
  await setMethod(null);
  return { ok: true, notice: isClerkConfigured() ? "This copy now signs in with Clerk." : "This copy no longer asks for a password." };
}

export async function signOut(): Promise<void> {
  await endThisSession();
  redirect("/sign-in");
}

export async function signOutEverywhere(): Promise<void> {
  const owner = await ownerOrError();
  if (owner) await endAllSessions(owner.id);
  redirect("/sign-in");
}

export async function revokeSignInSession(id: string): Promise<SettingsResult> {
  const owner = await ownerOrError();
  if (!owner) return { ok: false, error: "Not signed in." };
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown session." };
  return (await revokeSession(owner.id, id)) ? { ok: true } : { ok: false, error: "That session already ended." };
}

// ── Reset at the machine ─────────────────────────────────────────────────────

/** The reset page exists only on a local install run by the supervisor. */
export async function resetAvailableHere(): Promise<boolean> {
  if (process.env.VERCEL_ENV || !process.env.LEDGR_SUPERVISOR_DIR) return false;
  const h = await headers();
  const hosts = [h.get("host"), h.get("x-forwarded-host")].filter((v): v is string => !!v);
  // Every address the request claims must be this machine: a request that came
  // in through a tunnel or Tailscale carries the public name instead.
  return hosts.length > 0 && hosts.every(isLoopbackHost);
}

function ticketPath(): string {
  return join(process.env.LEDGR_SUPERVISOR_DIR as string, RESET_TICKET_FILE);
}

async function ticketOk(token: unknown): Promise<boolean> {
  if (!(await resetAvailableHere())) return false;
  const p = ticketPath();
  const text = existsSync(p) ? readFileSync(p, "utf8") : null;
  return resetTicketValid(text, token, Date.now());
}

const TICKET_EXPIRED =
  "This reset link has expired or was already used. Right-click the Ledgr tray icon and choose Reset sign-in password again.";

/** Step 1: a new password and a fresh recovery kit. */
export async function resetAtMachine(token: string, password: string, confirm: string): Promise<SettingsResult> {
  if (!(await ticketOk(token))) return { ok: false, error: TICKET_EXPIRED };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };
  const holder = await passwordOwner();
  const ownerId = holder?.id ?? (await resolveInstanceOwner());
  if (!ownerId) return { ok: false, error: "This copy of Ledgr has no owner yet. Finish setup first." };
  await setPassword(ownerId, password);
  return { ok: true, kit: await issueRecoveryKit(ownerId) };
}

// ── First-run setup at the machine (ADR-275) ────────────────────────────────
//
// The same door as the reset above, pointed at an install with NO owner yet:
// the same localhost-only check, the same one-time ticket from the data folder
// (`npm run local:setup-owner`, or the tray's Reset sign-in password), and the
// same step 2 (finishResetAtMachine). Step 1 creates the owner instead of
// finding one. The ticket is the real proof: a request can claim to be
// addressed to localhost, but only someone signed in to this computer can read
// the data folder the ticket was written into.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // the shape seed.mjs refuses on

/** Step 1 of setup: create the owner, set the password, and hand back a kit. */
export async function createOwnerAtMachine(
  token: string,
  email: string,
  password: string,
  confirm: string
): Promise<SettingsResult> {
  if (!(await ticketOk(token))) {
    return {
      ok: false,
      error: "This setup link has expired or was already used. On this computer, run npm run local:setup-owner again.",
    };
  }
  const address = typeof email === "string" ? email.trim() : "";
  if (!EMAIL_RE.test(address) || address.length > 254) return { ok: false, error: "Enter your email address." };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };
  const owner = await claimFirstOwner(address, null);
  if (!owner) return { ok: false, error: "This copy of Ledgr already has an owner. Sign in instead." };
  await setPassword(owner.id, password);
  return { ok: true, kit: await issueRecoveryKit(owner.id) };
}

/** Step 2: one code typed back, then this copy uses password sign-in and this browser is signed in. */
export async function finishResetAtMachine(token: string, code: string): Promise<SettingsResult> {
  if (!(await ticketOk(token))) return { ok: false, error: TICKET_EXPIRED };
  const holder = await passwordOwner();
  if (!holder) return { ok: false, error: "Start again: no password was saved." };
  if (!(await recoveryCodeMatches(holder.id, code))) {
    return { ok: false, error: "That code doesn't match the kit above. Type one of the ten codes." };
  }
  try {
    unlinkSync(ticketPath()); // one use
  } catch {
    // already gone; the checks above passed, so carry on
  }
  await clearAttempts();
  await setMethod("builtin");
  await startSession(holder.id);
  return { ok: true };
}
