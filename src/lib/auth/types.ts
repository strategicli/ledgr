// Thin auth-provider interface (provider-interface discipline, CLAUDE.md).
// The app talks to this, never to Clerk directly, so a Phase 4 local
// single-user mode can stand in with a different implementation.

export type AuthUser = {
  // Provider-issued identity; maps to users.clerk_id for the Clerk provider.
  externalId: string;
  email: string | null;
};

export interface AuthProvider {
  // The signed-in user for the current request, or null when signed out.
  getCurrentUser(): Promise<AuthUser | null>;
}
