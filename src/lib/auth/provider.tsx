import { ClerkProvider } from "@clerk/nextjs";

// UI half of the auth seam: the layout wraps with this, not with Clerk.
// Without a publishable key (fresh clone, future local mode) it renders
// children directly so the app still builds and runs.
export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <>{children}</>;
  }
  return <ClerkProvider>{children}</ClerkProvider>;
}
