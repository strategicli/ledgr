// Local-peer auth (plan decision 5, ADR-206): a no-login fixed-identity
// provider for a hub/spoke peer running on the owner's own machine, where the
// machine login is the security boundary and the server binds to
// localhost/tailnet only. Production-allowed, unlike devAuthProvider — but
// NEVER on a deployed Vercel env, where a missing Clerk key stays the ADR-184
// fail-closed misconfiguration it always was.
//
// Deliberately imports nothing from @clerk/nextjs (verify-provider-seams
// restricts Clerk to the four seam files).
import { isDeployedEnv, isClerkConfigured } from "./keyless";
import type { AuthProvider } from "./types";

// "local-owner" matches no seeded clerk_id, so resolveOwner falls through to
// the email lookup — and its backfill never overwrites an existing clerk_id
// link, so a restored production database keeps its Clerk link intact while
// this identity signs in beside it.
export const LOCAL_OWNER_ID = "local-owner";

export const localAuthProvider = (email: string): AuthProvider => ({
  async getCurrentUser() {
    return { externalId: LOCAL_OWNER_ID, email };
  },
});

export type ProviderChoice = "clerk" | "local" | "dev" | "null";

/**
 * The provider-selection rule, pure so verify-supervisor.mts can sweep the
 * env combinations. Order matters and is the safety property:
 *  1. A configured Clerk always wins (hubs keep Clerk exactly as today).
 *  2. Local mode needs LEDGR_LOCAL_OWNER_EMAIL AND no Clerk AND not a
 *     deployed Vercel env — a deploy missing its Clerk key must keep failing
 *     closed (nullAuthProvider + the middleware's 503), never fall into a
 *     no-login mode.
 *  3. The dev stand-in is unchanged (development + DEV_USER_EMAIL).
 *  4. Otherwise nobody is signed in.
 */
export function chooseAuthProvider(env: {
  clerkConfigured: boolean;
  deployed: boolean;
  localOwnerEmail: string | undefined;
  nodeEnv: string | undefined;
  devUserEmail: string | undefined;
}): ProviderChoice {
  if (env.clerkConfigured) return "clerk";
  if (env.localOwnerEmail && !env.deployed) return "local";
  if (env.nodeEnv === "development" && env.devUserEmail) return "dev";
  return "null";
}

/** The live choice, from the real process env. */
export function chooseFromProcessEnv(): ProviderChoice {
  return chooseAuthProvider({
    clerkConfigured: isClerkConfigured(),
    deployed: isDeployedEnv(),
    localOwnerEmail: process.env.LEDGR_LOCAL_OWNER_EMAIL || undefined,
    nodeEnv: process.env.NODE_ENV,
    devUserEmail: process.env.DEV_USER_EMAIL || undefined,
  });
}

/**
 * May the no-login mode serve this process (ADR-275)? The supervisor tells the
 * app where it listens (LEDGR_LISTEN_HOST). It keeps a no-login install on
 * 127.0.0.1, so "every network" here means the owner just switched sign-in off
 * and the app has not been moved back yet: in that moment nobody is signed in
 * by default. Unset (an older supervisor, `npm run dev`) keeps today's rule.
 */
export function noLoginListenOk(listenHost: string | undefined): boolean {
  return !listenHost || listenHost === "127.0.0.1";
}
