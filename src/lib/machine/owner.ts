// The single owner that token-authenticated app-integration endpoints act for
// (GET/POST /api/machine/items — the external HTTP API). Single-user v1
// (ADR-006): the same person as every other machine path, resolved by UPN — an
// explicit optional knob (LEDGR_API_OWNER_UPN), then the shared mailbox/export
// fallbacks, then the dev stand-in (DEV_USER_EMAIL) so it works locally without
// Microsoft config. Kept separate from resolveMcpOwner so the REST surface
// isn't coupled to the MCP module; multi-user would map each token to its owner.
import { resolveMailboxOwner } from "@/lib/calendar/owner";

export async function resolveMachineOwner(): Promise<string | null> {
  const upn =
    process.env.LEDGR_API_OWNER_UPN ||
    process.env.ONEDRIVE_EXPORT_UPN ||
    process.env.GRAPH_MAILBOX_UPN ||
    process.env.DEV_USER_EMAIL;
  return upn ? resolveMailboxOwner(upn) : null;
}
