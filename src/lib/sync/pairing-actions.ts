"use server";
// The one action a stranger-facing page may call for pairing (ADR-277): the
// owner typing the hub's code on a fresh cloud copy's /setup. It grants nothing
// by itself; the rules (empty, unowned, inside the window) are in pairing.ts.
import { enterPairingCode } from "@/lib/sync/pairing-cloud";

export async function submitPairingCode(code: string): Promise<{ ok: boolean; error?: string }> {
  return enterPairingCode(code);
}
