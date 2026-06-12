import { clerkAuthProvider } from "./clerk";
import type { AuthProvider } from "./types";

// Everyone-is-signed-out provider for keyless runs (fresh clone, CI build).
// Clerk's auth() throws when its middleware never ran, so the choice has to
// happen here, not inside the Clerk provider.
const nullAuthProvider: AuthProvider = {
  async getCurrentUser() {
    return null;
  },
};

// Dev-only stand-in (the Phase 4 local single-user mode in miniature): lets
// UI work be exercised locally without a Clerk session. Three gates so it
// can never serve real traffic: no Clerk key configured, NODE_ENV is
// development, and DEV_USER_EMAIL explicitly set. resolveOwner never lets
// this identity overwrite an existing clerk_id link.
const devAuthProvider = (email: string): AuthProvider => ({
  async getCurrentUser() {
    return { externalId: "dev-local", email };
  },
});

// The one place the active provider is chosen. A Phase 4 local build swaps
// this assignment; nothing else in the app changes.
export const authProvider: AuthProvider = process.env
  .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkAuthProvider
  : process.env.NODE_ENV === "development" && process.env.DEV_USER_EMAIL
    ? devAuthProvider(process.env.DEV_USER_EMAIL)
    : nullAuthProvider;

export type { AuthProvider, AuthUser } from "./types";
