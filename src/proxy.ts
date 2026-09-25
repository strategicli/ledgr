import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isClerkConfigured, keylessAllowed } from "@/lib/auth/keyless";
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
  // Public share links (slice 31): an unguessable token is the credential, so
  // the render path takes no Clerk session. Issuance (/api/items/[id]/share)
  // stays Clerk-protected.
  "/share(.*)",
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
// One JSON log line per blocked request, in the shape src/lib/log.ts emits — but
// written inline, because importing that module pulls the DB client into the
// middleware bundle for a line of text.
function failClosed(request: NextRequest): NextResponse {
  if (isPublicRoute(request)) return NextResponse.next();
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
    "Authentication is not configured on this deployment. See /health.",
    { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}

const handler = isClerkConfigured()
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) {
        await auth.protect();
      }
    })
  : keylessAllowed()
    ? () => NextResponse.next()
    : failClosed;

export default handler;

export const config = {
  matcher: [
    // All routes except /health, Next internals, and static files.
    "/((?!health|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's auto-proxy path (keyless/dev proxying) must hit the middleware.
    "/__clerk/:path*",
  ],
};
