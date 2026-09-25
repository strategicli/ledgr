// Verification for the built-in owner sign-in (ADR-274). PURE: no database, no
// server, so it runs in CI on every PR. It walks the design's security
// checklist (the Ledgr note "Ledgr sign-in: built-in owner login beside Clerk",
// section 5) one line at a time, then the recovery kit, the reset ticket, the
// shared owner lookup and the sync merge for the password columns.
//
// NOTE: this file must never contain the literal name of the database env var,
// the db module's import path, or its accessor's name: verify-ci.mjs would
// classify it as backend-needing and silently drop it from CI.
//
// Run: npx tsx scripts/verify-builtin-auth.mts
import { readFileSync } from "node:fs";
import {
  FREE_ATTEMPTS,
  gateDecision,
  generateRecoveryCodes,
  hashPassword,
  hashRecoveryCode,
  isLoopbackHost,
  lockoutRemainingMs,
  matchRecoveryCode,
  needsRenewal,
  newSessionToken,
  normalizeRecoveryCode,
  passwordProblem,
  RECOVERY_CODE_COUNT,
  RECOVERY_LOW,
  RESET_TICKET_FILE,
  resetTicketValid,
  safeRedirect,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  sessionCookieOptions,
  sessionLabel,
  signSessionCookie,
  verifyPassword,
  verifySessionCookie,
} from "../src/lib/auth/builtin-core";
import { chooseAuthProvider } from "../src/lib/auth/local";
import { pickInstanceOwner } from "../src/lib/instance-owner";
import { mergeOps, opFieldKeys, type LocalState, type SyncOp } from "../src/lib/sync/engine";
import { serializeSigninReset, signinResetPath } from "../supervisor/lib.mjs";
import { EXCLUDED_TABLES } from "./lib/pg-copy.mjs";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const read = (p: string) => readFileSync(p, "utf8");

const CORE = read("src/lib/auth/builtin-core.ts");
const SERVER = read("src/lib/auth/builtin.ts");
const STATE = read("src/lib/auth/builtin-state.ts");
const ACTIONS = read("src/lib/auth/signin-actions.ts");
const PROXY = read("src/proxy.ts");
const NOW = Date.parse("2026-09-25T12:00:00Z");

// ── 1. Comparing secrets in a way that leaks timing clues ──────────────────
console.log("\n1. Constant-time comparison");
check(
  "password and cookie checks use timingSafeEqual",
  /timingSafeEqual\(actual, expected\)/.test(CORE) && /timingSafeEqual\(expected, given\)/.test(CORE)
);
check("recovery codes compare through digestsMatch (timingSafeEqual)", /digestsMatch\(digest, h\)/.test(CORE));
check(
  "matchRecoveryCode checks every stored code, no early exit",
  /hashes\.forEach/.test(CORE) && !/hashes\.(find|some|findIndex)\(/.test(CORE)
);
check(
  "no secret is compared with === anywhere in the sign-in code",
  ![CORE, SERVER, ACTIONS].some((s) => /(passwordHash|tokenHash|cookieSecret|expected|digest)\s*===/.test(s))
);

// ── 2. Weak or fast password hashing ────────────────────────────────────────
console.log("\n2. Password hashing (scrypt)");
const pwHash = await hashPassword("correct horse battery");
const [algo, logN, r, p, salt, key] = pwHash.split("$");
check("stored as scrypt with its parameters", algo === "scrypt" && pwHash.split("$").length === 6, pwHash.slice(0, 16));
check(
  "strength is at least an OWASP scrypt setting (2^15, r=8, p=3 or stronger)",
  Number(logN) >= 15 && Number(r) >= 8 && 2 ** Number(logN) * Number(p) >= 2 ** 15 * 3,
  `N=2^${logN} r=${r} p=${p}`
);
check("a fresh 16-byte salt per hash", Buffer.from(salt, "base64url").length === 16 && Buffer.from(key, "base64url").length === 32);
check("the same password hashes differently twice (salted)", (await hashPassword("correct horse battery")) !== pwHash);
check("the right password verifies", await verifyPassword("correct horse battery", pwHash));
check("a wrong password does not", !(await verifyPassword("correct horse batterY", pwHash)));
check("no stored hash means no", !(await verifyPassword("anything", null)));
check("a malformed stored hash is simply no", !(await verifyPassword("x", "scrypt$15$8$3$zz")));
check(
  "a stored hash asking for absurd work is refused, not run (it syncs between copies)",
  !(await verifyPassword("x", `scrypt$30$8$3$${salt}$${key}`)) && !(await verifyPassword("x", `scrypt$15$8$99$${salt}$${key}`))
);
check("passwords shorter than 8 are refused", passwordProblem("short") !== null && passwordProblem("12345678") === null);
check("absurdly long passwords are refused", passwordProblem("x".repeat(257)) !== null);

// ── 3. Reusing a session code after login ───────────────────────────────────
console.log("\n3. A fresh session code on every sign-in");
check("session codes are 32 random bytes and never repeat", newSessionToken() !== newSessionToken() && newSessionToken().length === 43);
{
  const start = SERVER.slice(SERVER.indexOf("export async function startSession"));
  const body = start.slice(0, start.indexOf("\n}\n"));
  check(
    "startSession ends any session the browser had and mints a new code",
    /newSessionToken\(\)/.test(body) && /delete\(signinSessions\)/.test(body)
  );
}
check("only the code's sha256 is stored", /tokenHash: hashToken\(token\)/.test(SERVER));
check(
  "every sign-in path goes through startSession",
  (ACTIONS.match(/await startSession\(/g) ?? []).length >= 4
);

// ── 4. Cookies scripts can read, or sent over plain HTTP ────────────────────
console.log("\n4. The cookie");
const opts = sessionCookieOptions();
check("the name carries the __Host- prefix", SESSION_COOKIE.startsWith("__Host-"));
check(
  "httpOnly, Secure, SameSite=Lax, Path=/, no Domain",
  opts.httpOnly === true && opts.secure === true && opts.sameSite === "lax" && opts.path === "/" && !("domain" in opts)
);
check("it lasts 90 days", SESSION_MAX_AGE_SEC === 90 * 24 * 3600 && opts.maxAge === SESSION_MAX_AGE_SEC);
check(
  "every place that writes the cookie uses sessionCookieOptions",
  [SERVER, PROXY].every((s) =>
    (s.match(/\.set\(\s*SESSION_COOKIE[^;]*;/g) ?? []).every((call) => /sessionCookieOptions\(/.test(call))
  ) && /\.set\(\s*SESSION_COOKIE/.test(PROXY)
);
{
  const secret = "s".repeat(43);
  const token = newSessionToken();
  const iat = Math.floor(NOW / 1000);
  const good = signSessionCookie(token, iat, secret);
  check("a signed cookie verifies", verifySessionCookie(good, secret, NOW)?.token === token);
  check("a tampered code fails", verifySessionCookie(good.replace(token, newSessionToken()), secret, NOW) === null);
  check("a tampered signature fails", verifySessionCookie(`${good.slice(0, -2)}AA`, secret, NOW) === null);
  check("another install's secret fails", verifySessionCookie(good, "t".repeat(43), NOW) === null);
  check("a rotated secret (sign out everywhere) fails", verifySessionCookie(good, `${secret}x`, NOW) === null);
  check("older than 90 days fails", verifySessionCookie(signSessionCookie(token, iat - SESSION_MAX_AGE_SEC - 1, secret), secret, NOW) === null);
  check("issued in the future fails", verifySessionCookie(signSessionCookie(token, iat + 3600, secret), secret, NOW) === null);
  check("garbage fails", ["", "v1", "v2.a.b.c", `v1.${token}.x.y`, "a".repeat(400)].every((v) => verifySessionCookie(v, secret, NOW) === null));
  check("renews after a day of use, not before", needsRenewal(iat - 86401, NOW) && !needsRenewal(iat - 3600, NOW));
}

// ── 5. Forgetting to protect a new page ─────────────────────────────────────
console.log("\n5. Locked by default");
{
  const list = PROXY.slice(PROXY.indexOf("const CORE_PUBLIC_ROUTES = ["), PROXY.indexOf("];", PROXY.indexOf("const CORE_PUBLIC_ROUTES")));
  const routes = [...list.matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
  const expected = [
    "/sign-in(.*)",
    "/api/machine(.*)",
    "/api/mcp(.*)",
    "/.well-known/(.*)",
    "/api/oauth/protected-resource",
    "/api/oauth/authorization-server",
    "/api/oauth/register",
    "/api/oauth/token",
    "/api/ics(.*)",
    "/files/(.*)",
    "/capture/share",
    "/reset-password",
    // ADR-275: the setup page. Its create-owner step needs the same localhost
    // address and machine ticket as the reset page (verify-first-run.mts).
    "/setup",
    // ADR-277: the cloud-copy pairing door. It grants nothing on a copy with an
    // owner or data (verify-pairing.mts).
    "/api/pair",
  ];
  check(
    "the public list is explicit and exactly the known set (a new public path is a deliberate edit here)",
    JSON.stringify(routes) === JSON.stringify(expected),
    routes.join(" ")
  );
  check("the reset page is public by its exact path only", !routes.includes("/reset-password(.*)"));
  check("the Clerk branch still protects every other route", /await auth\.protect\(\)/.test(PROXY));
  check("the keyless branch follows the pure gate rule", /gateDecision\(\{/.test(PROXY));
  const d = (x: Partial<Parameters<typeof gateDecision>[0]>) =>
    gateDecision({ isPublic: false, builtinCookieValid: false, clerkConfigured: false, deployed: false, builtinOn: false, ...x });
  check("a valid password session passes", d({ builtinCookieValid: true, deployed: true }) === "pass");
  check("public routes pass", d({ isPublic: true, deployed: true }) === "pass");
  check("with Clerk and no password session, Clerk decides (unchanged)", d({ clerkConfigured: true }) === "clerk" && d({ clerkConfigured: true, builtinOn: true }) === "clerk");
  check("password sign-in on, no session: go sign in", d({ builtinOn: true }) === "sign-in" && d({ builtinOn: true, deployed: true }) === "sign-in");
}

// ── 6. Guessing the password over and over ─────────────────────────────────
console.log("\n6. Slowing down guessing");
{
  const at = new Date(NOW);
  check("the first five attempts are free", lockoutRemainingMs(FREE_ATTEMPTS - 1, at, NOW) === 0);
  check("then 30 seconds", lockoutRemainingMs(FREE_ATTEMPTS, at, NOW) === 30_000);
  check("doubling", lockoutRemainingMs(FREE_ATTEMPTS + 2, at, NOW) === 120_000);
  check("capped at 15 minutes", lockoutRemainingMs(FREE_ATTEMPTS + 30, at, NOW) === 15 * 60_000);
  check("and it wears off", lockoutRemainingMs(FREE_ATTEMPTS, at, NOW + 30_001) === 0);
  for (const fn of ["signInWithPassword", "signInWithRecoveryCode", "switchToPassword"]) {
    const start = ACTIONS.indexOf(`export async function ${fn}`);
    const body = ACTIONS.slice(start, ACTIONS.indexOf("\n}\n", start));
    const claim = body.indexOf("claimAttempt()");
    const verify = Math.max(body.indexOf("verifyPassword("), body.indexOf("consumeRecoveryCode("));
    check(`${fn} takes an attempt before checking the secret`, claim > 0 && verify > claim);
  }
  check(
    "the attempt counter moves with a conditional write (parallel guesses can't all slip in)",
    /eq\(signinInstall\.failedCount, s\.failedCount\)/.test(SERVER)
  );
}

// ── 7. Another site tricking your browser into acting ───────────────────────
console.log("\n7. Cross-site requests");
check("the cookie is SameSite=Lax (checked above)", opts.sameSite === "lax");
check(
  "every sign-in write is a server action, which Next only accepts from this site's own origin",
  ACTIONS.startsWith('"use server";')
);
check(
  "no allowedOrigins override loosens that origin check",
  !/allowedOrigins/.test(read("next.config.ts"))
);

// ── 8. Missing settings leaving the door open (ADR-184) ─────────────────────
console.log("\n8. Fail closed");
{
  const d = (x: Partial<Parameters<typeof gateDecision>[0]>) =>
    gateDecision({ isPublic: false, builtinCookieValid: false, clerkConfigured: false, deployed: true, builtinOn: false, ...x });
  check("deployed, no Clerk, no password sign-in: refused", d({}) === "refuse");
  check("deployed, state unreadable: refused", d({ builtinOn: null }) === "refuse");
  check("deployed, password sign-in on: served through the sign-in page", d({ builtinOn: true }) === "sign-in");
  check(
    "local no-login mode survives only where it always did",
    d({ deployed: false }) === "pass" && d({ deployed: false, builtinOn: true }) === "sign-in"
  );
  check(
    "the no-login provider closes once password sign-in is on, and when that can't be read",
    /fallbackIsNoLogin && \(await builtinOnState\(\)\) !== false\) return null/.test(SERVER)
  );
  const base = { clerkConfigured: false, deployed: false, localOwnerEmail: undefined, nodeEnv: "production", devUserEmail: undefined };
  check("a configured Clerk still wins the provider choice", chooseAuthProvider({ ...base, clerkConfigured: true, localOwnerEmail: "a@b.c" }) === "clerk");
  check("a deploy missing its Clerk key never gets the no-login mode", chooseAuthProvider({ ...base, deployed: true, localOwnerEmail: "a@b.c" }) === "null");
  check("password sign-in is off on Vercel previews", /VERCEL_ENV !== "preview"/.test(STATE));
  check("Clerk stays the default: only an explicit 'builtin' switches a copy", /state\?\.method === "builtin" \? "builtin" : null/.test(STATE));
}

// ── 9. Passwords or cookies showing up in logs ──────────────────────────────
console.log("\n9. Nothing secret is logged");
check(
  "the sign-in modules never log at all",
  [CORE, SERVER, STATE, ACTIONS].every((s) => !/console\.|createLogger|captureError/.test(s))
);
{
  const logs = [...PROXY.matchAll(/console\.\w+\(([\s\S]*?)\n {2}\);/g)].map((m) => m[1]);
  check(
    "the gate's only log line carries no cookie or header",
    logs.length === 1 && !/cookies|headers|SESSION_COOKIE|renewed/.test(logs[0])
  );
}

// ── 10. A "go here after login" link sending you to another site ────────────
console.log("\n10. Safe redirect");
const redirects: [unknown, string][] = [
  ["/tasks?x=1#top", "/tasks?x=1#top"],
  ["/", "/"],
  ["https://evil.example/", "/"],
  ["//evil.example/", "/"],
  ["/\\evil.example", "/"],
  ["javascript:alert(1)", "/"],
  [" /tasks", "/"],
  ["/sign-in?redirect_url=/x", "/"],
  [undefined, "/"],
  ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
];
for (const [input, want] of redirects) {
  check(`safeRedirect(${JSON.stringify(input)}) → ${want}`, safeRedirect(input) === want, safeRedirect(input));
}
check("sign-in uses safeRedirect", /redirect\(safeRedirect\(form\.get\("redirect_url"\)\)\)/.test(ACTIONS));

// ── The recovery kit ────────────────────────────────────────────────────────
console.log("\nRecovery kit");
{
  const codes = generateRecoveryCodes();
  const hashes = codes.map(hashRecoveryCode);
  check("ten codes", codes.length === RECOVERY_CODE_COUNT && RECOVERY_CODE_COUNT === 10);
  check("all different", new Set(codes).size === 10);
  check("readable shape, no look-alike characters", codes.every((c) => /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/.test(c)));
  check("typed in lower case with spaces, it still matches", matchRecoveryCode(codes[3].toLowerCase().replace(/-/g, " "), hashes) === 3);
  check("a wrong code does not", matchRecoveryCode("AAAA-AAAA-AAAA-AAAA", hashes) === -1);
  check("a used code (removed from the kit) no longer matches", matchRecoveryCode(codes[3], hashes.filter((_, i) => i !== 3)) === -1);
  check("a new kit voids the old one", matchRecoveryCode(codes[0], generateRecoveryCodes().map(hashRecoveryCode)) === -1);
  check("normalizing ignores dashes and case", normalizeRecoveryCode("ab-cd ef") === "ABCDEF");
  check("only hashes are stored", /recoveryCodes: codes\.map\(hashRecoveryCode\)/.test(SERVER));
  check("Settings warns at 2 left", RECOVERY_LOW === 2);
  check(
    "switching to password sign-in needs the password AND one recovery code typed back",
    /verifyPassword\(password, holder\.passwordHash\)/.test(ACTIONS) && /recoveryCodeMatches\(owner\.id, code\)/.test(ACTIONS)
  );
  check("the reset at the machine can't finish without a code typed back", /recoveryCodeMatches\(holder\.id, code\)/.test(ACTIONS));
}

// ── Reset at the machine ────────────────────────────────────────────────────
console.log("\nReset at the machine");
{
  const token = newSessionToken();
  const file = serializeSigninReset(token, new Date(NOW));
  check("the supervisor and the app agree on the ticket file name", signinResetPath("/d").replace(/\\/g, "/").endsWith(`/${RESET_TICKET_FILE}`));
  check("the ticket file never holds the ticket itself", !file.includes(token));
  check("a fresh ticket is accepted", resetTicketValid(file, token, NOW + 60_000));
  check("a wrong ticket is refused", !resetTicketValid(file, newSessionToken(), NOW));
  check("after 15 minutes it is refused", !resetTicketValid(file, token, NOW + 15 * 60_000 + 1));
  check("no ticket file, no reset", !resetTicketValid(null, token, NOW));
  check(
    "only localhost addresses count as this machine",
    ["localhost:3100", "127.0.0.1:3100", "[::1]:3000", "LOCALHOST"].every(isLoopbackHost) &&
      !["ledgr.brasco.fyi", "bc-edgewood.tail1234.ts.net", "192.168.1.5:3000", "localhost.evil.com", "", null].some((h) => isLoopbackHost(h as string))
  );
  check("the ticket is used up on success", /unlinkSync\(ticketPath\(\)\)/.test(ACTIONS));
  check(
    "the reset page refuses Vercel, non-supervised copies, and tunnelled requests",
    /process\.env\.VERCEL_ENV \|\| !process\.env\.LEDGR_SUPERVISOR_DIR/.test(ACTIONS) && /hosts\.every\(isLoopbackHost\)/.test(ACTIONS)
  );
}

// ── Sync rules: what travels and what stays ─────────────────────────────────
console.log("\nSync");
{
  check("the install's sign-in state and sessions are never copied by a fill", EXCLUDED_TABLES.has("signin_install") && EXCLUDED_TABLES.has("signin_sessions"));
  const USER = "00000000-0000-4000-8000-00000000000a";
  const op = (changed: Record<string, unknown>, at: string, deviceId = "aaaaaaaa-0000-4000-8000-000000000001"): SyncOp => ({
    seq: 1, deviceId, originDeviceId: null, ownerId: USER, at, schemaVer: "t", tbl: "users", rowId: USER, kind: "update", changed,
  });
  const state = (row: Record<string, unknown>, fields: LocalState["rows"] extends Map<string, infer V> ? V extends { fields: infer F } ? F : never : never = {}): LocalState => ({
    ownerIds: new Set([USER]),
    rows: new Map([[`users:${USER}`, { row: { id: USER, ...row }, fields }]]),
    relationByKey: new Map(),
  });
  check(
    "an op carrying the password stamps it as its own field",
    JSON.stringify(opFieldKeys("users", { settings: { accent: "x" }, password_hash: "h" })) === JSON.stringify(["settings.accent", "password_hash"]) &&
      JSON.stringify(opFieldKeys("users", { password_hash: "h" })) === JSON.stringify(["password_hash"])
  );
  const applied = mergeOps([op({ password_hash: "new", recovery_codes: ["c"] }, "2026-09-25T10:00:00Z")], state({ password_hash: "old", recovery_codes: [], settings: {} }));
  const act = applied.actions[0] as { fields?: Record<string, unknown> } | undefined;
  check("a password change from another copy is applied", act?.fields?.password_hash === "new" && JSON.stringify(act?.fields?.recovery_codes) === '["c"]');
  const stale = mergeOps(
    [op({ password_hash: "older" }, "2026-09-25T09:00:00Z")],
    state({ password_hash: "local", settings: {} }, { password_hash: { at: "2026-09-25T10:00:00Z", deviceId: "b" } })
  );
  check("an older password change loses to a newer local one", stale.actions.length === 0);
  const sneaky = mergeOps([op({ email: "attacker@x", clerk_id: "u_1" }, "2026-09-25T10:00:00Z")], state({ email: "me@x", clerk_id: null, settings: {} }));
  check("an op can't rewrite who the owner is (email and clerk_id don't sync)", sneaky.actions.length === 0);
  const MIG = read("drizzle/0065_builtin_signin.sql");
  check(
    "the trigger logs the two sign-in columns beside settings",
    /OLD\.password_hash IS DISTINCT FROM NEW\.password_hash/.test(MIG) && /jsonb_build_object\('recovery_codes'/.test(MIG)
  );
  check("the per-install tables get no sync trigger", !/signin_(install|sessions)_sync/.test(MIG));
  check("the migration only adds (no DROP TABLE / DROP COLUMN / NOT NULL on users)", !/DROP TABLE|DROP COLUMN|ALTER COLUMN/i.test(MIG) && !/ADD COLUMN "[a-z_]+" [a-z]+ NOT NULL/.test(MIG));
  check("peers pause until both take it (version stamp bumped)", /UPDATE "sync_schema_ver" SET "ver" = '0065_builtin_signin'/.test(MIG));
}

// ── Phase 0: one shared owner lookup ────────────────────────────────────────
console.log("\nThe shared owner lookup");
{
  const rows = [{ id: "1", email: "Brandon@Example.org" }];
  check("matches case-insensitively", pickInstanceOwner(rows, ["brandon@example.org"]) === "1");
  check("a renamed owner email no longer strands a single-owner install", pickInstanceOwner(rows, ["old@example.org"]) === "1");
  check("with no address at all, the only owner", pickInstanceOwner(rows, []) === "1");
  const two = [...rows, { id: "2", email: "tyler@example.org" }];
  check("with two people it never guesses", pickInstanceOwner(two, ["nobody@x"]) === null);
  check("with two people the address decides", pickInstanceOwner(two, [undefined, "TYLER@example.org"]) === "2");
  const mcp = read("src/lib/mcp/owner.ts");
  const machine = read("src/lib/machine/owner.ts");
  check("MCP and the API both use the shared lookup", /resolveInstanceOwner/.test(mcp) && /resolveInstanceOwner/.test(machine));
  check("the shared chain includes a local install's owner email", /LEDGR_LOCAL_OWNER_EMAIL/.test(read("src/lib/instance-owner.ts")));
}

check("the sessions list label never keeps the raw user agent", sessionLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120") === "Edge on Windows");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
