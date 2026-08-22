// The spoke-side sync loop (built in phase 1, armed in phase 3): push local
// ops / pull remote ops against an ORDERED hub list, walking to the next hub
// on failure — that walk IS the backup-hub behavior. Dependency-free by
// design (fetch + setTimeout); runs inside the app process via the
// instrumentation hook, only when LEDGR_SYNC_HUBS is set, so the cloud hub
// (passive) and Tyler's instance never start it.
//
// Env:
//   LEDGR_SYNC_HUBS             comma-separated ordered hub base URLs
//   LEDGR_SYNC_TOKEN            this device's token (minted on the hub)
//   LEDGR_SYNC_PUSH_DEBOUNCE_MS default 2000 — how soon after a write we push
//   LEDGR_SYNC_PULL_MS          default 10000 — the full-exchange cadence
//
// Cursors persist in job_state (one row per hub) — sync bookkeeping, exactly
// what that table exists for; no new table needed.
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState, syncDevice, syncOps } from "@/db/schema";
import { applySyncOps } from "./apply";
import { latestSchemaVer } from "./version";
import type { SyncOp } from "./engine";
import { createLogger } from "@/lib/log";

const log = createLogger("sync-client");

export type SyncState = "synced" | "pending" | "offline";

export type SyncStatus = {
  state: SyncState;
  pendingOps: number;
  activeHubIndex: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

// In-memory status for the future SyncPill (phase 3). Module-level is enough:
// `next start` on a local peer is one long-lived process.
const status: SyncStatus = {
  state: "offline",
  pendingOps: 0,
  activeHubIndex: 0,
  lastSyncAt: null,
  lastError: null,
};

export function getSyncStatus(): SyncStatus {
  return { ...status };
}

// The hub list, parsed the one way everywhere (loop arming, status endpoint,
// the nav pill's server-side gate).
export function parseHubs(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

// Is this instance a sync SPOKE at all? False on the cloud hub and on Tyler's
// instance (no LEDGR_SYNC_HUBS), which is what keeps every sync surface —
// the /api/sync/status work, the nav pill mount — off those deploys entirely.
export function syncEnabled(): boolean {
  return parseHubs(process.env.LEDGR_SYNC_HUBS).length > 0;
}

export type FullSyncStatus =
  | { enabled: false }
  | ({ enabled: true; hubCount: number } & SyncStatus);

// Pure shape assembly (verify-sync-ui.mts exercises this): the in-memory loop
// status plus an on-demand pendingOps count. Freshly written ops the loop
// hasn't pushed yet flip a "synced" reading to "pending" — the loop only
// refreshes its own copy when it runs, and the status endpoint reads between
// runs.
export function buildSyncStatus(
  hubs: string[],
  s: SyncStatus,
  pendingOps: number
): FullSyncStatus {
  if (hubs.length === 0) return { enabled: false };
  return {
    enabled: true,
    hubCount: hubs.length,
    ...s,
    pendingOps,
    state: s.state === "synced" && pendingOps > 0 ? "pending" : s.state,
  };
}

// The /api/sync/status read: cheap `{enabled: false}` with zero queries when
// the loop isn't armed, otherwise the live status with pendingOps computed
// from the oplog (max local seq past the active hub's push cursor).
export async function gatherSyncStatus(): Promise<FullSyncStatus> {
  const hubs = parseHubs(process.env.LEDGR_SYNC_HUBS);
  if (hubs.length === 0) return { enabled: false };
  const s = getSyncStatus();
  const hub = hubs[Math.min(Math.max(s.activeHubIndex, 0), hubs.length - 1)];
  const cursor = await readCursor(hub);
  const pendingOps = await pendingCount(cursor.push);
  return buildSyncStatus(hubs, s, pendingOps);
}

const PUSH_BATCH = 500;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

type Cursor = { push: number; pull: number };

async function readCursor(hub: string): Promise<Cursor> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, `sync:cursor:${hub}`));
  const v = rows[0]?.value as Partial<Cursor> | undefined;
  return { push: Number(v?.push ?? 0), pull: Number(v?.pull ?? 0) };
}

async function writeCursor(hub: string, cursor: Cursor): Promise<void> {
  await getDb()
    .insert(jobState)
    .values({ key: `sync:cursor:${hub}`, value: cursor })
    .onConflictDoUpdate({
      target: jobState.key,
      set: { value: cursor, updatedAt: new Date() },
    });
}

async function localDeviceId(): Promise<string> {
  const rows = await getDb().select({ id: syncDevice.id }).from(syncDevice).limit(1);
  if (!rows[0]) throw new Error("no sync_device row — has migration 0054 run?");
  return rows[0].id;
}

// Original local writes not yet pushed. Foreign-origin ops (echoes we applied)
// are excluded from push — the hub already has them.
async function unpushedOps(afterSeq: number): Promise<SyncOp[]> {
  const rows = await getDb()
    .select()
    .from(syncOps)
    .where(and(gt(syncOps.seq, afterSeq), isNull(syncOps.originDeviceId)))
    .orderBy(asc(syncOps.seq))
    .limit(PUSH_BATCH);
  return rows.map((r) => ({
    seq: r.seq,
    deviceId: r.deviceId,
    originDeviceId: r.originDeviceId,
    ownerId: r.ownerId,
    at: r.at.toISOString(),
    tbl: r.tbl,
    rowId: r.rowId,
    kind: r.kind as SyncOp["kind"],
    changed: r.changed as Record<string, unknown>,
    schemaVer: r.schemaVer,
  }));
}

async function pendingCount(afterSeq: number): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<string>`count(*)::text` })
    .from(syncOps)
    .where(and(gt(syncOps.seq, afterSeq), isNull(syncOps.originDeviceId)));
  return Number(rows[0]?.n ?? 0);
}

// One full exchange with one hub: push until drained, pull until drained.
// Throws on any transport/HTTP failure so the caller can walk the hub list.
async function exchangeWith(hub: string, deviceId: string, token: string): Promise<void> {
  const schemaVer = latestSchemaVer();
  let cursor = await readCursor(hub);
  // Bounded loop: worst case both sides hold deep backlogs; each round moves
  // at least one batch, and the caller reruns on the next tick anyway.
  for (let round = 0; round < 20; round++) {
    const ops = await unpushedOps(cursor.push);
    const res = await fetch(`${hub.replace(/\/$/, "")}/api/machine/sync`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId, schemaVer, sinceSeq: cursor.pull, ops }),
    });
    if (res.status === 409) {
      const detail = (await res.json().catch(() => ({}))) as { localVer?: string };
      throw new Error(
        `schema version mismatch: hub has ${detail.localVer ?? "?"}, this peer has ${schemaVer}`
      );
    }
    if (!res.ok) throw new Error(`sync exchange failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      ops: SyncOp[];
      cursor: number;
      hasMore: boolean;
    };
    if (data.ops.length > 0) {
      await applySyncOps(data.ops);
    }
    cursor = {
      push: ops.length > 0 ? ops[ops.length - 1].seq : cursor.push,
      pull: Number(data.cursor ?? cursor.pull),
    };
    await writeCursor(hub, cursor);
    if (!data.hasMore && ops.length < PUSH_BATCH) break;
  }
  status.pendingOps = await pendingCount(cursor.push);
}

async function exchange(hubs: string[], deviceId: string, token: string): Promise<void> {
  for (let i = 0; i < hubs.length; i++) {
    try {
      await exchangeWith(hubs[i], deviceId, token);
      status.activeHubIndex = i;
      status.lastSyncAt = new Date().toISOString();
      status.lastError = null;
      status.state = status.pendingOps > 0 ? "pending" : "synced";
      return;
    } catch (err) {
      status.lastError = err instanceof Error ? err.message : String(err);
      log.warn("hub exchange failed, walking the list", { hub: hubs[i], error: status.lastError });
    }
  }
  status.state = "offline";
}

/**
 * Start the loop. One fast timer carries both cadences: every
 * PUSH_DEBOUNCE_MS it checks whether new local ops exist (the "push soon
 * after a write" behavior, detected by watching max(seq) — no app hook
 * needed, the triggers already made the oplog the write signal), and at
 * least every PULL_MS it exchanges regardless, so remote edits land within
 * the pull window.
 */
export function startSyncLoop(): void {
  const g = globalThis as { __ledgrSyncLoop?: boolean };
  if (g.__ledgrSyncLoop) return;
  const hubs = parseHubs(process.env.LEDGR_SYNC_HUBS);
  const token = process.env.LEDGR_SYNC_TOKEN;
  if (hubs.length === 0 || !token) return;
  g.__ledgrSyncLoop = true;

  const pushDebounceMs = envInt("LEDGR_SYNC_PUSH_DEBOUNCE_MS", 2000);
  const pullMs = envInt("LEDGR_SYNC_PULL_MS", 10000);

  let deviceId: string | null = null;
  let lastSeenSeq = -1;
  let lastFullExchange = 0;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      deviceId ??= await localDeviceId();
      const head = await getDb()
        .select({ max: sql<string>`coalesce(max(${syncOps.seq}), 0)::text` })
        .from(syncOps)
        .where(isNull(syncOps.originDeviceId));
      const maxSeq = Number(head[0]?.max ?? 0);
      const due = Date.now() - lastFullExchange >= pullMs;
      const wrote = lastSeenSeq >= 0 && maxSeq > lastSeenSeq;
      if (due || wrote || lastSeenSeq < 0) {
        await exchange(hubs, deviceId, token);
        lastFullExchange = Date.now();
      }
      lastSeenSeq = maxSeq;
    } catch (err) {
      status.state = "offline";
      status.lastError = err instanceof Error ? err.message : String(err);
      log.warn("sync tick failed", { error: status.lastError });
    } finally {
      running = false;
    }
  };

  log.info("sync loop armed", { hubs: hubs.length, pushDebounceMs, pullMs });
  const timer = setInterval(() => void tick(), pushDebounceMs);
  // Never hold the process open just to sync; the app server does that.
  timer.unref?.();
  void tick();
}
