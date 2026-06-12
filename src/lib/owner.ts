import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { authProvider } from "@/lib/auth";

export type Owner = {
  id: string;
  email: string;
};

// Resolves the signed-in user to their users row; owner-scoped queries start
// from the returned id. First sign-in finds the seeded row by email and
// backfills clerk_id (the seed can't know it); after that the clerk_id
// lookup hits. No row is created here: v1 is single-user, and an
// authenticated stranger (sign-ups are restricted in Clerk, so this is
// belt-and-suspenders) gets null, same as signed out.
export async function resolveOwner(): Promise<Owner | null> {
  const authUser = await authProvider.getCurrentUser();
  if (!authUser) return null;

  const db = getDb();
  const byClerkId = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.clerkId, authUser.externalId));
  if (byClerkId.length > 0) return byClerkId[0];

  if (!authUser.email) return null;
  const linked = await db
    .update(users)
    .set({ clerkId: authUser.externalId })
    .where(eq(users.email, authUser.email))
    .returning({ id: users.id, email: users.email });
  return linked[0] ?? null;
}
