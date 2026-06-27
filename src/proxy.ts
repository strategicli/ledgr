import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Route protection (next_steps.md step 3): every route requires a signed-in
// user except the public set below. Falls through when no Clerk key is
// configured so the scaffold runs before Clerk is set up (and in a future
// local mode). /health and /api/machine/* are excluded from Clerk entirely:
// machine endpoints authenticate with scoped API tokens, never Clerk
// (CLAUDE.md); /health is the matcher exclusion, machine routes verify
// their own Bearer token in the handler.
const isPublicRoute = createRouteMatcher([
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
  // Todoist signs its webhook with an HMAC (no Bearer token); the route
  // verifies the signature itself (slice 25). Only the webhook is public —
  // /api/todoist/sync stays Clerk-protected.
  "/api/todoist/webhook",
  // Public share links (slice 31): an unguessable token is the credential, so
  // the render path takes no Clerk session. Issuance (/api/items/[id]/share)
  // stays Clerk-protected.
  "/share(.*)",
  // Published ICS task feed (T4, ADR-079): an unguessable token in the URL is
  // the credential, so calendar apps subscribe with no Clerk session. The
  // token-management route (/api/ics/token) still gates itself with
  // requireOwner, which 401s an anonymous caller, so this is safe.
  "/api/ics(.*)",
]);

const handler = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) {
        await auth.protect();
      }
    })
  : () => NextResponse.next();

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
