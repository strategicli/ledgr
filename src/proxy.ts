import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Initializes Clerk's request context only; route protection is the auth
// slice (next_steps.md step 3). Falls through when no key is configured so
// the scaffold runs before Clerk is set up (and in a future local mode).
// /health is excluded: machine endpoints authenticate with scoped API
// tokens, never Clerk (CLAUDE.md).
const handler = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware()
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    // All routes except /health, Next internals, and static files.
    "/((?!health|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
