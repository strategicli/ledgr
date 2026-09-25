// Resolves the owner the MCP server acts for. The MCP token is a personal token
// (PRD §5.5), but the token scheme (ADR-004) stores only name+scopes+hash, no
// owner — so single-user v1 resolves the install's one owner through the
// shared lookup (src/lib/instance-owner.ts): LEDGR_MCP_OWNER_UPN is this
// surface's explicit knob, then the shared chain (export/mailbox UPN, a local
// install's LEDGR_LOCAL_OWNER_EMAIL, the dev stand-in), then the only users row.
// Multi-user would map each token to its own owner instead.
import { resolveInstanceOwner } from "@/lib/instance-owner";

export async function resolveMcpOwner(): Promise<string | null> {
  return resolveInstanceOwner([process.env.LEDGR_MCP_OWNER_UPN]);
}
