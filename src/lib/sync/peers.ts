// Synced-devices management (plan decision 15): the hub's device registry
// behind /build/updates. Tokens are minted here, shown to the owner exactly
// once, and stored only as a sha256 hash (the machine.ts posture); revocation
// is a row flip, so a lost device is shut out without a redeploy. sync_peers
// is instance-global machinery (like `types`): no owner_id column, and the
// routes over this lib are owner-authed (requireOwner), never machine-authed.
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState, syncOps, syncPeers } from "@/db/schema";
import { hashToken } from "@/lib/auth/machine";
import type { SyncDb } from "./apply";

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

// Guardrail 1's hub-side belt-and-suspenders: whether /api/machine/sync must
// refuse this request outright. Pure so it's testable without a route in the
// loop; the check does not depend on the spoke's own honesty.
export function pullOnlyRejectsPush(pullOnly: boolean, opsCount: number): boolean {
  return pullOnly && opsCount > 0;
}

// The staleness refusal (ADR-208): a peer whose pull cursor points into
// pruned oplog territory must be REFUSED, not silently handed the partial
// stream that remains — ops in (sinceSeq, prunedThrough] are gone forever,
// so "give it what's left" is a permanently incomplete database that reports
// synced. sinceSeq 0 is deliberately exempt: a freshly FILLED peer starts at
// cursor 0 with current data, and its first pull legitimately replays
// whatever the oplog still holds (LWW makes that a no-op against the fill).
// The start-empty trap (cursor 0, empty data) is a different failure with
// its own warning in supervisor/README.md; seq alone cannot distinguish it.
export function cursorTooStale(sinceSeq: number, prunedThrough: number): boolean {
  return sinceSeq > 0 && sinceSeq < prunedThrough;
}

// Push dedupe (same ADR): ops this peer has already pushed are dropped, not
// re-applied. Re-delivery is real — a response lost after the hub applied a
// push makes the client re-send the same batch, and before this guard each
// re-apply wrote real rows whose triggers logged fresh hub ops (unbounded
// oplog growth). lastPushedSeq is the boundary because the client pushes in
// ascending local seq. Known ceiling: a spoke restored from its own old
// backup rewinds its seq and would see its first pushes dropped — that spoke
// needs a re-fill anyway, which resets its device identity.
export function dedupePushedOps<T extends { seq: number }>(ops: T[], lastPushedSeq: number): T[] {
  return ops.filter((o) => o.seq > lastPushedSeq);
}

// ── DB-backed operations ─────────────────────────────────────────────────────

export type PeerSummary = {
  deviceId: string;
  name: string;
  revoked: boolean;
  // Guardrail 1: this device may pull but the hub refuses any push from it.
  pullOnly: boolean;
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
      pullOnly: syncPeers.pullOnly,
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
    pullOnly: r.pullOnly,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    opsBehind: cursorLag(maxSeq, r.lastPulledSeq),
  }));
}

// Mints a device row + its token. The returned plaintext is the ONLY copy —
// the row keeps just the hash — so the caller shows it once and drops it.
// pullOnly defaults false; the Add-device UI offers it as the safe default
// for a brand-new peer (guardrail 1).
export async function createPeer(
  name: string,
  opts: { pullOnly?: boolean } = {}
): Promise<{ deviceId: string; name: string; token: string }> {
  const token = generateSyncToken();
  const deviceId = crypto.randomUUID();
  await getDb().insert(syncPeers).values({
    deviceId,
    name,
    tokenHash: hashToken(token),
    pullOnly: opts.pullOnly === true,
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

// Flip a device between pull-only and full. This is the "arming sync safely"
// lever: add a device pull-only, confirm data flows down, then flip to full.
// Returns false when no such device exists.
export async function setPeerPullOnly(deviceId: string, pullOnly: boolean): Promise<boolean> {
  const rows = await getDb()
    .update(syncPeers)
    .set({ pullOnly })
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

// ── Oplog retention (ADR-206 follow-up) ─────────────────────────────────────
//
// The one machine-side function in this file: the daily purge cron calls it
// (src/app/api/machine/purge/route.ts), not a requireOwner route. It lives
// here because peer cursors are what makes pruning safe.

// How long an op is kept regardless of cursors. Sized off the bootstrap path:
// a new peer first-fills from the WEEKLY pg_dump backup and then reconciles
// the delta out of the oplog (scripts/local-restore.mjs), so the tail only has
// to cover backup age plus slack.
export const SYNC_OPS_RETENTION_DAYS = 14;

// Delete ops that are past the retention floor AND already pulled by every
// registered (non-revoked) device. With no live peers at all — prod today,
// and Tyler's instance always — the oplog serves nobody, so the cursor guard
// falls away and the time floor alone applies.
//
// A registered device that has NEVER pulled sits at cursor 0 and therefore
// pins the whole log, which is the point: it hasn't got that history yet. If
// such a device is dead, revoke or delete it in Build → Updates; until then
// the daily purge log shows 0 pruned.
export async function pruneSyncOps(opts: { db?: SyncDb } = {}) {
  const db = opts.db ?? (getDb() as unknown as SyncDb);
  // seq is the primary key, so the cursor bound is an index range scan and
  // `at` is a filter over it — the two are monotonic together. No index on
  // `at`: it would cost an extra index write on EVERY app write (the triggers
  // fire on items/relations/revisions/...) to speed up one daily statement.
  const res = await db.execute(sql`
    delete from sync_ops
    where at < now() - make_interval(days => ${SYNC_OPS_RETENTION_DAYS})
      and seq <= coalesce(
        (select min(last_pulled_seq) from sync_peers where revoked = false),
        (select coalesce(max(seq), 0) from sync_ops)
      )
    returning seq
  `);
  // Record the boundary the staleness refusal compares against (ADR-208):
  // the highest seq ever actually deleted. Exact by construction — a
  // bigserial gap below min(seq) was never an op, so "min(seq) - 1" would
  // over-refuse; this never does. Monotonic upsert: a smaller run can't move
  // it backwards. Instance-local on purpose (job_state is not in the synced
  // set), the same as the cursors it protects.
  if (res.rows.length > 0) {
    const maxPruned = res.rows.reduce(
      (m, r) => Math.max(m, Number((r as { seq: unknown }).seq)),
      0
    );
    await db.execute(sql`
      insert into job_state (key, value)
      values (${SYNC_PRUNED_THROUGH_KEY}, jsonb_build_object('seq', ${maxPruned}::bigint))
      on conflict (key) do update set
        value = case
          when coalesce((job_state.value->>'seq')::bigint, 0) >= ${maxPruned}::bigint
            then job_state.value
          else excluded.value
        end,
        updated_at = now()
    `);
  }
  return { syncOpsPruned: res.rows.length };
}

// job_state key for the prune boundary above. Read per exchange by
// /api/machine/sync; missing (a hub that has never pruned, or pruned only
// before ADR-208 landed) reads as 0, which refuses nobody — the status quo.
export const SYNC_PRUNED_THROUGH_KEY = "sync:prunedThrough";

export async function readPrunedThrough(): Promise<number> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, SYNC_PRUNED_THROUGH_KEY));
  const seq = (rows[0]?.value as { seq?: unknown } | undefined)?.seq;
  const n = Number(seq);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
