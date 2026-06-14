// Resolves the owner the MCP server acts for. The MCP token is a personal token
// (PRD §5.5), but the token scheme (ADR-004) stores only name+scopes+hash, no
// owner — so single-user v1 resolves the one users row the same way the other
// machine paths do: by a UPN env var. LEDGR_MCP_OWNER_UPN is the explicit knob;
// it falls back to the export/mailbox UPN (same person) and, in dev, to the
// DEV_USER_EMAIL stand-in (ADR-006) so the route works locally without
// Microsoft config. Multi-user would map each token to its own owner instead.
import { resolveMailboxOwner } from "@/lib/calendar/owner";

export async function resolveMcpOwner(): Promise<string | null> {
  const upn =
    process.env.LEDGR_MCP_OWNER_UPN ||
    process.env.ONEDRIVE_EXPORT_UPN ||
    process.env.GRAPH_MAILBOX_UPN ||
    process.env.DEV_USER_EMAIL;
  return upn ? resolveMailboxOwner(upn) : null;
}
