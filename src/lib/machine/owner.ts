// The single owner that token-authenticated app-integration endpoints act for
// (GET/POST /api/machine/items — the external HTTP API). Single-user v1
// (ADR-006): the same person as every other machine path, through the shared
// lookup (src/lib/instance-owner.ts) — LEDGR_API_OWNER_UPN is this surface's
// optional knob, then the shared chain, then the only users row. Kept separate
// from resolveMcpOwner so the REST surface isn't coupled to the MCP module;
// multi-user would map each token to its owner.
import { resolveInstanceOwner } from "@/lib/instance-owner";

export async function resolveMachineOwner(): Promise<string | null> {
  return resolveInstanceOwner([process.env.LEDGR_API_OWNER_UPN]);
}
