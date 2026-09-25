// Resolves the Todoist account's Ledgr owner for the machine paths (cron,
// webhook) that have no signed-in user. Single-user v1: the Todoist token is
// Brandon's, so the owner is the users row for his UPN. TODOIST_OWNER_UPN
// overrides; it defaults to the export UPN (same person). Multi-user-ready: a
// future per-account mapping replaces this.
import { resolveMailboxOwner } from "@/lib/calendar/owner";

export async function resolveTodoistOwner(): Promise<string | null> {
  const upn =
    process.env.TODOIST_OWNER_UPN ||
    process.env.ONEDRIVE_EXPORT_UPN ||
    process.env.GRAPH_MAILBOX_UPN;
  return upn ? resolveMailboxOwner(upn) : null;
}
