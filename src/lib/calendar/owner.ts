// Resolves the mailbox UPN to its users row. The calendar sync (and email-in,
// later) write into one person's data, so the job belongs to that users row —
// the same resolution the OneDrive export does by ONEDRIVE_EXPORT_UPN.
// Multi-user-ready: a future per-user sync would read per-user config instead.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export async function resolveMailboxOwner(upn: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, upn.toLowerCase()));
  return rows[0]?.id ?? null;
}
