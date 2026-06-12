import { auth, currentUser } from "@clerk/nextjs/server";
import type { AuthProvider } from "./types";

export const clerkAuthProvider: AuthProvider = {
  async getCurrentUser() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await currentUser();
    return {
      externalId: userId,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
    };
  },
};
