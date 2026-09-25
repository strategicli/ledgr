// Built-in owner sign-in, the pure half (ADR-274). No database, no Next, no
// Clerk: only Node's built-in crypto, so the proxy, the server code, the reset
// command and scripts/verify-builtin-auth.mts all share one implementation, and
// every line of the design's security checklist is testable without a server.
//
// The design (Ledgr note "Ledgr sign-in: built-in owner login beside Clerk"):
// one owner per install, a password (scrypt hash on the synced users row), a
// signed random session code in a locked-down cookie, ten one-time recovery
// codes, and a per-install failed-attempt counter.
import { createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { digestsMatch, hashToken } from "./machine";

// ── Passwords ────────────────────────────────────────────────────────────────

// scrypt at N=2^15, r=8, p=3: one of OWASP's listed equivalents for scrypt
// (same work as 2^17/8/1 with a quarter of the memory, which matters on a
// serverless function). ~32 MiB and ~100ms per hash. Stored with its
// parameters, so raising them later only needs new hashes, not a migration.
const SCRYPT = { logN: 15, r: 8, p: 3, keyLen: 32, saltLen: 16 } as const;
// Upper bounds on what a STORED hash may ask for. The hash syncs between
// copies, so a malformed or hostile one must not be able to make a sign-in
// attempt allocate gigabytes.
const MAX_LOG_N = 17;
const MAX_P = 8;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

function scrypt(password: string, salt: Buffer, logN: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keyLen, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 * 4 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  );
}

/** A reason the password can't be used, or null when it can. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** `scrypt$<logN>$<r>$<p>$<salt>$<hash>`, salt and hash base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLen);
  const key = await scrypt(password, salt, SCRYPT.logN, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
  return ["scrypt", SCRYPT.logN, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time check. A malformed or out-of-bounds stored hash is simply "no". */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [logN, r, p] = parts.slice(1, 4).map((n) => Number(n));
  if (![logN, r, p].every(Number.isInteger)) return false;
  if (logN < 10 || logN > MAX_LOG_N || r < 1 || r > 32 || p < 1 || p > MAX_P) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
  const actual = await scrypt(password, salt, logN, r, p, expected.length);
  return timingSafeEqual(actual, expected);
}

// ── Recovery codes ───────────────────────────────────────────────────────────

export const RECOVERY_CODE_COUNT = 10;
/** Settings warns once this many or fewer are left. */
export const RECOVERY_LOW = 2;
// No 0/O, 1/I/L: the codes get read off paper.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Ten fresh codes, each 16 characters (~79 bits) shown as XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = "";
    for (let j = 0; j < 16; j++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    codes.push(raw.match(/.{4}/g)!.join("-"));
  }
  return codes;
}

/** What a person typed, reduced to the code itself (case, spaces and dashes ignored). */
export function normalizeRecoveryCode(input: unknown): string {
  return typeof input === "string" ? input.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

// The codes carry ~79 bits of randomness, so a fast hash is enough (a slow one
// would make checking ten of them cost a second); it is the same sha256 the
// API tokens use.
export function hashRecoveryCode(code: string): string {
  return hashToken(normalizeRecoveryCode(code));
}

/** Index of the matching stored hash, or -1. Compares against EVERY hash, no early exit. */
export function matchRecoveryCode(input: unknown, hashes: readonly string[] | null | undefined): number {
  const code = normalizeRecoveryCode(input);
  if (code.length !== 16 || !Array.isArray(hashes)) return -1;
  const digest = hashToken(code);
  let found = -1;
  hashes.forEach((h, i) => {
    if (typeof h === "string" && /^[0-9a-f]{64}$/.test(h) && digestsMatch(digest, h) && found === -1) found = i;
  });
  return found;
}

// ── Session cookie ───────────────────────────────────────────────────────────

// __Host-: the browser only accepts it with Secure, Path=/ and no Domain, so it
// can never be set over plain HTTP or scoped wider than this exact host.
export const SESSION_COOKIE = "__Host-ledgr_session";
export const SESSION_DAYS = 90;
export const SESSION_MAX_AGE_SEC = SESSION_DAYS * 24 * 60 * 60;
// Re-sign the cookie at most daily, so an active session keeps renewing.
export const RENEW_AFTER_SEC = 24 * 60 * 60;
const CLOCK_SKEW_SEC = 5 * 60;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newCookieSecret(): string {
  return randomBytes(32).toString("base64url");
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** `v1.<token>.<issued-at seconds>.<hmac>` */
export function signSessionCookie(token: string, iatSec: number, secret: string): string {
  const payload = `v1.${token}.${iatSec}`;
  return `${payload}.${mac(payload, secret)}`;
}

/** The token and its issue time, or null for anything forged, stale or malformed. */
export function verifySessionCookie(
  value: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number
): { token: string; iat: number } | null {
  if (typeof value !== "string" || !secret || value.length > 300) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, token, iatRaw, sig] = parts;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^\d{1,12}$/.test(iatRaw)) return null;
  const expected = Buffer.from(mac(`v1.${token}.${iatRaw}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const iat = Number(iatRaw);
  const now = Math.floor(nowMs / 1000);
  if (iat > now + CLOCK_SKEW_SEC || now - iat > SESSION_MAX_AGE_SEC) return null;
  return { token, iat };
}

export function needsRenewal(iatSec: number, nowMs: number): boolean {
  return Math.floor(nowMs / 1000) - iatSec > RENEW_AFTER_SEC;
}

/** The only cookie shape this feature ever writes. */
export function sessionCookieOptions(maxAgeSec = SESSION_MAX_AGE_SEC) {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: maxAgeSec };
}

// ── After sign-in: where to go ───────────────────────────────────────────────

/** Only this app's own relative paths. Anything else (another site, //host, a script URL) is "/". */
export function safeRedirect(target: unknown): string {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) return "/";
  if (/[\\\s\u0000-\u001f]/.test(target) || target.length > 2000) return "/";
  try {
    const base = "http://ledgr.invalid";
    const url = new URL(target, base);
    if (url.origin !== base) return "/";
    if (url.pathname.startsWith("/sign-in")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

// ── Slowing down guessing ────────────────────────────────────────────────────

export const FREE_ATTEMPTS = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;

/** How long until the next attempt is allowed: 0 for the first five, then 30s doubling to 15 min. */
export function lockoutRemainingMs(failedCount: number, failedAt: Date | null, nowMs: number): number {
  if (failedCount < FREE_ATTEMPTS || !failedAt) return 0;
  const wait = Math.min(FIRST_WAIT_MS * 2 ** (failedCount - FREE_ATTEMPTS), MAX_WAIT_MS);
  return Math.max(0, failedAt.getTime() + wait - nowMs);
}

// ── The front gate (ADR-184, fail closed) ────────────────────────────────────

export type GateDecision = "pass" | "clerk" | "sign-in" | "refuse";

/**
 * What the proxy does with a request, as a pure rule. The safety property:
 * a deployed copy with no sign-in set up is REFUSED, never served; password
 * sign-in counts as "set up"; the local no-login mode survives only where it
 * always did (not deployed, no Clerk, password sign-in not switched on).
 * `builtinOn` is null when the install state could not be read.
 */
export function gateDecision(g: {
  isPublic: boolean;
  builtinCookieValid: boolean;
  clerkConfigured: boolean;
  deployed: boolean;
  builtinOn: boolean | null;
}): GateDecision {
  if (g.isPublic || g.builtinCookieValid) return "pass";
  if (g.clerkConfigured) return "clerk";
  if (g.builtinOn === true) return "sign-in";
  if (g.deployed) return "refuse";
  // Not deployed and not switched on (or unknown): today's local no-login /
  // fresh-clone behavior. The server-side provider re-checks and itself fails
  // closed when the state is unknown, so an unreadable database serves no data.
  return "pass";
}

// ── The sessions list ────────────────────────────────────────────────────────

/** "Edge on Windows" from a user agent. Never stores or shows the raw string. */
export function sessionLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "A browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone or iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "an unknown device";
  return `${browser} on ${os}`;
}

// ── The reset page at the machine ────────────────────────────────────────────

/** Is this the machine itself, by the address the browser used? */
export function isLoopbackHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

// Where ledgr-ctl writes the one-time reset ticket, inside the supervisor's data
// folder. Mirrored in supervisor/lib.mjs (signinResetPath); the verify script
// checks the two agree.
export const RESET_TICKET_FILE = "signin-reset.json";
export const RESET_TICKET_MINUTES = 15;

/** The ticket file's content is `{hash, expiresAt}`; true when `token` matches and is unexpired. */
export function resetTicketValid(fileText: string | null, token: unknown, nowMs: number): boolean {
  if (!fileText || typeof token !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) return false;
  try {
    const t = JSON.parse(fileText) as { hash?: unknown; expiresAt?: unknown };
    if (typeof t.hash !== "string" || typeof t.expiresAt !== "string") return false;
    const exp = Date.parse(t.expiresAt);
    if (!Number.isFinite(exp) || exp < nowMs) return false;
    return digestsMatch(hashToken(token), t.hash);
  } catch {
    return false;
  }
}
