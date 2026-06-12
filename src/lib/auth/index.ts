import { clerkAuthProvider } from "./clerk";
import type { AuthProvider } from "./types";

// The one place the active provider is chosen. A Phase 4 local build swaps
// this assignment; nothing else in the app changes.
export const authProvider: AuthProvider = clerkAuthProvider;

export type { AuthProvider, AuthUser } from "./types";
