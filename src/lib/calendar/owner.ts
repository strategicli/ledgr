// Resolves the mailbox UPN to its users row. The calendar sync (and email-in,
// later) write into one person's data, so the job belongs to that users row —
// the same resolution the OneDrive export does by ONEDRIVE_EXPORT_UPN.
// Goes through the shared owner lookup (src/lib/instance-owner.ts), so a
// case difference or a renamed owner email on a single-owner install no
// longer strands the job.
import { resolveInstanceOwner } from "@/lib/instance-owner";

export async function resolveMailboxOwner(upn: string): Promise<string | null> {
  return resolveInstanceOwner([upn]);
}
