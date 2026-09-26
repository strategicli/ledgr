import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isClerkConfigured, keylessAllowed } from "@/lib/auth/keyless";
import {
  gateDecision,
  needsRenewal,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSessionCookie,
  verifySessionCookie,
} from "@/lib/auth/builtin-core";
import { builtinAllowedHere, builtinOnState, readInstallSafe } from "@/lib/auth/builtin-state";
import { modulePublicPaths } from "@/lib/modules";
import "@/lib/modules/register";

// Route protection (next_steps.md step 3): every route requires a signed-in
// user except the public set below. Falls through when no Clerk key is
// configured so the scaffold runs before Clerk is set up (and in a future
// local mode). /health and /api/machine/* are excluded from Clerk entirely:
// machine endpoints authenticate with scoped API tokens, never Clerk
// (CLAUDE.md); /health is the matcher exclusion, machine routes verify
// their own Bearer token in the handler.
const CORE_PUBLIC_ROUTES = [
  "/sign-in(.*)",
  "/api/machine(.*)",
  // The MCP server (slice 36, ADR-047) authenticates with a scoped machine
  // token in the handler, never Clerk — same door as /api/machine/*.
  "/api/mcp(.*)",
  // OAuth shim for the MCP server (ADR-117). Discovery, registration, and the
  // token exchange must be reachable before any credential exists, so they're
  // public; the /.well-known paths rewrite onto the two metadata routes
  // (middleware sees the pre-rewrite path, so match it here). NOTE the
  // authorize endpoint (/api/oauth/authorize) is deliberately NOT listed: it
  // stays Clerk-protected so only the signed-in owner can mint MCP tokens.
  "/.well-known/(.*)",
  "/api/oauth/protected-resource",
  "/api/oauth/authorization-server",
  "/api/oauth/register",
  "/api/oauth/token",
  // Published ICS task feed (T4, ADR-079): an unguessable token in the URL is
  // the credential, so calendar apps subscribe with no Clerk session. The
  // token-management route (/api/ics/token) still gates itself with
  // requireOwner, which 401s an anonymous caller, so this is safe.
  "/api/ics(.*)",
  // Attachment addresses (ADR-228): /files/<id> redirects to the stored bytes,
  // and the unguessable attachment UUID is the credential — the same contract as
  // /share above. It MUST be public: a public share page renders an item body
  // whose images are these addresses, and that viewer has no Clerk session.
  "/files/(.*)",
  // PWA share target POST (ADR-191): a cold Android share arrives after the
  // 60s Clerk session JWT has expired. Clerk heals an expired token via a
  // redirect "handshake", but its SDK only allows that for GET
  // (isRequestEligibleForHandshake in @clerk/backend) — a POST with a stale
  // token reads as signed out and auth.protect() would 307 it to /sign-in,
  // which 500s on a POST. So the route itself authenticates (resolveOwner)
  // and, when auth is stale, 303s the payload to the GET claim route below,
  // which CAN handshake. EXACT path only (no wildcard): this must not also
  // match /capture/share/claim, which stays Clerk-protected.
  "/capture/share",
  // "Reset sign-in password" at the machine (ADR-274): the locked-out owner
  // must reach it signed out. The page answers only a request addressed to
  // localhost that carries the one-time ticket ledgr-ctl wrote into this
  // install's data folder; anything else is a 404.
  "/reset-password",
  // The setup page (ADR-275): what is missing and what to do, for the person who
  // cannot sign in yet. Once the copy has an owner, a visitor who is not that
  // owner sees only "set up, sign in"; creating the first owner there needs the
  // same localhost address and one-time ticket as the reset page.
  "/setup",
  // The cloud-copy pairing door (ADR-277): a hub asks whether this copy is empty
  // and open to pairing, then offers the one-time code its owner typed on
  // /setup. Like the OAuth registration door, it must answer before any
  // credential exists; everything it grants is decided in pairing-cloud.ts, and
  // it grants nothing on a copy that has an owner or data.
  "/api/pair",
];

// Modules add their own public paths through the manifest `publicPaths` slot
// (ADR-272 step 3). This takes EVERY registered module's paths, on or off: the
// proxy runs before auth on every request and must stay fast, so it never reads
// the owner's settings. A switched-off module's route is refused by the route
// itself (plan step 4). The registry and its manifests are plain TypeScript with
// no DB, React or Node-only imports, so they load in the proxy runtime, and the
// list is built once at load, not per request.
const isPublicRoute = createRouteMatcher([...CORE_PUBLIC_ROUTES, ...modulePublicPaths()]);

// No Clerk key on a DEPLOYED environment is a misconfiguration, not a mode.
// Without this branch the fallback below runs instead and protects nothing, while
// the server-side provider reports every caller as signed out — the door open and
// the app convinced it's empty (see src/lib/auth/keyless.ts, ADR-184). Fail closed.
//
// Public routes still pass: /api/machine/*, /api/mcp, the Todoist webhook, /share
// and /api/ics all authenticate themselves with a scoped token, HMAC, or an
// unguessable URL, and never depended on Clerk. Keeping them reachable means a
// missing key doesn't also silently break cron, the MCP server, and the ICS feed.
// /health sits outside the matcher entirely, so it stays up as the diagnostic.
//
// Password sign-in (ADR-274) counts as sign-in being set up: a deployed copy
// with no Clerk key but password sign-in switched on serves through it (see
// gateDecision in src/lib/auth/builtin-core.ts, the pure rule this follows).
//
// One JSON log line per blocked request, in the shape src/lib/log.ts emits —
// written inline to keep the proxy's imports to what it needs.
function failClosed(request: NextRequest): NextResponse {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      source: "middleware.auth",
      correlationId: crypto.randomUUID(),
      message:
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY missing on a deployed environment; refusing the request",
      path: request.nextUrl.pathname,
      vercelEnv: process.env.VERCEL_ENV ?? null,
    })
  );
  return new NextResponse(
    "Sign-in is not set up on this copy of Ledgr. Open /setup to see what is missing and what to do.",
    { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}

// ── Built-in password sign-in at the gate (ADR-274) ─────────────────────────
//
// The gate checks the cookie's signature and age only; the server-side
// provider then looks the session up in the database, so a signed-out or
// revoked session renders signed out even inside its 90 days (the same split
// Clerk has: its JWT is verified here, its session state by the server). "Sign
// out everywhere" also replaces the signing secret, which this check reads
// through a 15-second cache.
//
// No cookie means no work at all: an install that never uses password sign-in
// (every Clerk install, until its owner opts in) makes no database read here.
async function builtinCookie(request: NextRequest): Promise<{ valid: boolean; renewed?: string }> {
  if (!builtinAllowedHere()) return { valid: false };
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return { valid: false };
  const state = await readInstallSafe();
  if (!state) return { valid: false };
  const now = Date.now();
  const v = verifySessionCookie(raw, state.cookieSecret, now);
  if (!v) return { valid: false };
  return {
    valid: true,
    // Re-signed at most daily, so a session in use keeps renewing its 90 days.
    renewed: needsRenewal(v.iat, now)
      ? signSessionCookie(v.token, Math.floor(now / 1000), state.cookieSecret)
      : undefined,
  };
}

function passBuiltin(renewed: string | undefined): NextResponse {
  const res = NextResponse.next();
  if (renewed) res.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions());
  return res;
}

// Signed out on a password-sign-in copy: pages go to the sign-in page (and come
// back afterwards); API calls get a plain 401.
function toSignIn(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("redirect_url", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

// No Clerk key: the local no-login mode, a password-sign-in copy, or (deployed,
// neither) the fail-closed refusal.
async function keylessHandler(request: NextRequest): Promise<NextResponse> {
  const isPublic = isPublicRoute(request);
  const b = isPublic ? { valid: false } : await builtinCookie(request);
  const decision = gateDecision({
    isPublic,
    builtinCookieValid: b.valid,
    clerkConfigured: false,
    deployed: !keylessAllowed(),
    builtinOn: isPublic || b.valid ? false : await builtinOnState(),
  });
  if (decision === "pass") return b.valid ? passBuiltin(b.renewed) : NextResponse.next();
  if (decision === "sign-in") return toSignIn(request);
  return failClosed(request);
}

const handler = isClerkConfigured()
  ? clerkMiddleware(async (auth, request) => {
      if (isPublicRoute(request)) return;
      // Both doors open (the design): a valid password session passes beside
      // Clerk's. Without one, Clerk decides exactly as before; its redirect
      // lands on /sign-in, which shows the password form on a copy that uses it.
      const b = await builtinCookie(request);
      if (b.valid) return passBuiltin(b.renewed);
      await auth.protect();
    })
  : keylessHandler;

export default handler;

export const config = {
  matcher: [
    // All routes except /health, Next internals, and static files. Also not
    // /files/local/: its signed URL is the credential, and with the proxy in
    // front Next cuts request bodies at 10MB, truncating big uploads. Nor
    // /restore-upload (a backup file, one-time token, ADR-282), same reason.
    "/((?!health|_next|files/local/|restore-upload|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's auto-proxy path (keyless/dev proxying) must hit the middleware.
    "/__clerk/:path*",
  ],
};
