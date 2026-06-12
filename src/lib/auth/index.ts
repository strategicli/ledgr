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

// The one place the active provider is chosen. A Phase 4 local build swaps
// this assignment; nothing else in the app changes.
export const authProvider: AuthProvider = process.env
  .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkAuthProvider
  : nullAuthProvider;

export type { AuthProvider, AuthUser } from "./types";
