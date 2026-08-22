// Synced-devices management (plan decision 15): the hub's device registry
// behind /build/updates. Tokens are minted here, shown to the owner exactly
// once, and stored only as a sha256 hash (the machine.ts posture); revocation
// is a row flip, so a lost device is shut out without a redeploy. sync_peers
// is instance-global machinery (like `types`): no owner_id column, and the
// routes over this lib are owner-authed (requireOwner), never machine-authed.
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { syncOps, syncPeers } from "@/db/schema";
import { hashToken } from "@/lib/auth/machine";

// ── Pure pieces (verify-sync-ui.mts exercises these with no DB) ─────────────

// ~32 bytes of entropy, base64url so it pastes cleanly (no padding, no
// URL-hostile characters).
export function generateSyncToken(): string {
  return randomBytes(32).toString("base64url");
}

// "n ops behind": the hub's newest oplog seq minus the peer's pull cursor.
// Never negative — a peer that has pulled everything reads 0 even if a race
// puts its cursor a hair ahead of the max we read.
export function cursorLag(hubMaxSeq: number, lastPulledSeq: number): number {
  return Math.max(0, Math.floor(hubMaxSeq) - Math.floor(lastPulledSeq));
}

// The lifecycle rule: delete is only for revoked devices, so a live device
// can never vanish in one click. Returns the refusal message, or null when
// deleting is allowed.
export function deleteRefusal(revoked: boolean): string | null {
  return revoked ? null : "Revoke the device before deleting it.";
}

// ── DB-backed operations ─────────────────────────────────────────────────────

export type PeerSummary = {
  deviceId: string;
  name: string;
  revoked: boolean;
  lastSeenAt: string | null;
  // Cursor lag, as ops (see cursorLag above).
  opsBehind: number;
};

export async function listPeers(): Promise<PeerSummary[]> {
  const db = getDb();
  const head = await db
    .select({ max: sql<string>`coalesce(max(${syncOps.seq}), 0)::text` })
    .from(syncOps);
  const maxSeq = Number(head[0]?.max ?? 0);
  const rows = await db
    .select({
      deviceId: syncPeers.deviceId,
      name: syncPeers.name,
      revoked: syncPeers.revoked,
      lastSeenAt: syncPeers.lastSeenAt,
      lastPulledSeq: syncPeers.lastPulledSeq,
      createdAt: syncPeers.createdAt,
    })
    .from(syncPeers);
  rows.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  return rows.map((r) => ({
    deviceId: r.deviceId,
    name: r.name,
    revoked: r.revoked,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    opsBehind: cursorLag(maxSeq, r.lastPulledSeq),
  }));
}

// Mints a device row + its token. The returned plaintext is the ONLY copy —
// the row keeps just the hash — so the caller shows it once and drops it.
export async function createPeer(
  name: string
): Promise<{ deviceId: string; name: string; token: string }> {
  const token = generateSyncToken();
  const deviceId = crypto.randomUUID();
  await getDb().insert(syncPeers).values({
    deviceId,
    name,
    tokenHash: hashToken(token),
  });
  return { deviceId, name, token };
}

// Revoke / restore. Returns false when no such device exists.
export async function setPeerRevoked(deviceId: string, revoked: boolean): Promise<boolean> {
  const rows = await getDb()
    .update(syncPeers)
    .set({ revoked })
    .where(eq(syncPeers.deviceId, deviceId))
    .returning({ deviceId: syncPeers.deviceId });
  return rows.length > 0;
}

export type DeletePeerResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export async function deletePeer(deviceId: string): Promise<DeletePeerResult> {
  const db = getDb();
  const rows = await db
    .select({ revoked: syncPeers.revoked })
    .from(syncPeers)
    .where(eq(syncPeers.deviceId, deviceId));
  if (!rows[0]) return { ok: false, status: 404, error: "no such device" };
  const refusal = deleteRefusal(rows[0].revoked);
  if (refusal) return { ok: false, status: 409, error: refusal };
  await db.delete(syncPeers).where(eq(syncPeers.deviceId, deviceId));
  return { ok: true };
}
