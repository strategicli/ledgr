import { withBuiltin } from "./builtin";
import { clerkAuthProvider } from "./clerk";
import { chooseFromProcessEnv, localAuthProvider } from "./local";
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

// The one place the active provider is chosen. The selection RULE is the pure
// chooseAuthProvider in ./local.ts (verified by verify-supervisor.mts); this
// just maps the choice onto the four implementations. localAuthProvider is
// the LH2 hub/spoke local mode (ADR-206 decision 5): production-allowed on a
// non-Vercel machine, while a deployed env missing its Clerk key still fails
// closed to nullAuthProvider (ADR-184).
//
// Every choice is wrapped by the built-in password sign-in (ADR-274): a valid
// built-in session is accepted beside any of them, and the local no-login mode
// closes once this copy switches to password sign-in. With no built-in cookie
// the wrapper does no work, so an install that never uses the feature is
// unchanged.
const choice = chooseFromProcessEnv();
const chosen: AuthProvider =
  choice === "clerk"
    ? clerkAuthProvider
    : choice === "local"
      ? localAuthProvider(process.env.LEDGR_LOCAL_OWNER_EMAIL as string)
      : choice === "dev"
        ? devAuthProvider(process.env.DEV_USER_EMAIL as string)
        : nullAuthProvider;
export const authProvider: AuthProvider = withBuiltin(chosen, choice === "local");

export type { AuthProvider, AuthUser } from "./types";
