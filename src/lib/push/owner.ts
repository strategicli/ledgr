// Resolves the owner the notification crons act for. Single-user v1: the
// notifications are Brandon's, so the owner is the users row for his UPN — the
// same resolution the export/calendar/Todoist machine paths use. Multi-user
// would iterate owners with subscriptions instead.
import { resolveMailboxOwner } from "@/lib/calendar/owner";

export async function resolveNotifyOwner(): Promise<string | null> {
  const upn = process.env.ONEDRIVE_EXPORT_UPN || process.env.GRAPH_MAILBOX_UPN;
  return upn ? resolveMailboxOwner(upn) : null;
}
