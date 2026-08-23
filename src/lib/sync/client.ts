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

// "held" = a push is deliberately withheld (first-push size guard or a
// clock-skew hold); pulling still proceeds in that state.
export type SyncState = "synced" | "pending" | "offline" | "held";

export type SyncMode = "full" | "pull-only";

export type HoldReason = "first_push_size" | "clock_skew";

export type SyncStatus = {
  state: SyncState;
  pendingOps: number;
  activeHubIndex: number;
  lastSyncAt: string | null;
  lastError: string | null;
  // Guardrail 2/3: why a push is currently held, if it is.
  holdReason: HoldReason | null;
  // Populated only when holdReason === "first_push_size".
  heldOpsCount: number | null;
  // Guardrail 3: last measured (serverTime - local time), ms. Positive means
  // the hub's clock reads ahead of this peer's. Null until the first
  // exchange completes (skew is learned FROM that exchange's response, so it
  // can never gate the very first round-trip — only ones after it).
  skewMs: number | null;
  // True once |skewMs| has reached the warn threshold, independent of hold.
  skewWarn: boolean;
};

// In-memory status for the SyncPill / /build/updates, plus the loop's
// one-shot first-push flag, held on globalThis.
//
// Module-level was NOT enough, which is what the first real spoke found:
// /api/sync/status and /build/updates reported "Offline, never synced" on a
// peer the database proved was pulling (a Principle 9 silent misreport). Next
// bundles the instrumentation hook and the route handlers as separate server
// entries, so this module is instantiated more than once in the one process.
// The loop mutated one instance's object; every reader read another's, which
// is still at its defaults and always will be. The loop-arming guard below
// already reached for globalThis for exactly this reason; the state it
// protects has to live there too, or the guard is the only part that works.
//
// This fixes duplication WITHIN a process, which is the observed cause. It
// cannot fix separate processes: if the app is ever served by more than one,
// status has to move to the database (job_state) instead.
type SyncShared = { status: SyncStatus; firstPushDone: boolean; loopArmed: boolean };
const shared: SyncShared = ((globalThis as { __ledgrSync?: SyncShared }).__ledgrSync ??= {
  status: {
    state: "offline",
    pendingOps: 0,
    activeHubIndex: 0,
    lastSyncAt: null,
    lastError: null,
    holdReason: null,
    heldOpsCount: null,
    skewMs: null,
    skewWarn: false,
  },
  // Guardrail 2's "only the FIRST push is gated" boundary: once a real push
  // attempt has been let through (or found nothing to send), this never gates
  // again for the rest of the process's lifetime. Deliberately separate from
  // `status`, which is allowed to move back and forth (e.g. holdReason clears
  // once resolved) — this flag must not.
  firstPushDone: false,
  loopArmed: false,
});
const status = shared.status;

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

// Guardrail 1: is this peer allowed to push at all? Read fresh from env
// everywhere (like parseHubs) rather than cached, since it's static config.
export function parseSyncMode(raw: string | undefined): SyncMode {
  return raw === "pull-only" ? "pull-only" : "full";
}

export type FullSyncStatus =
  | { enabled: false }
  | ({ enabled: true; hubCount: number; mode: SyncMode } & SyncStatus);

// Pure shape assembly (verify-sync-ui.mts exercises this): the in-memory loop
// status plus an on-demand pendingOps count. Freshly written ops the loop
// hasn't pushed yet flip a "synced" reading to "pending" — the loop only
// refreshes its own copy when it runs, and the status endpoint reads between
// runs. A "held" reading is never downgraded by the pendingOps recompute.
export function buildSyncStatus(
  hubs: string[],
  s: SyncStatus,
  pendingOps: number,
  mode: SyncMode
): FullSyncStatus {
  if (hubs.length === 0) return { enabled: false };
  return {
    enabled: true,
    hubCount: hubs.length,
    mode,
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
  return buildSyncStatus(hubs, s, pendingOps, parseSyncMode(process.env.LEDGR_SYNC_MODE));
}

// ── Guardrail 2: first-push size guard (pure, tested directly) ─────────────

export type FirstPushCheck =
  | { hold: false; done: true }
  | { hold: true; done: false; reason: string };

/**
 * Decide whether the client's first-ever push attempt this process should be
 * held. `firstPushDone` makes this a one-shot gate: once a decision comes
 * back non-held, the caller must flip it permanently so a legitimately busy
 * spoke is never throttled again.
 */
export function checkFirstPush(opts: {
  firstPushDone: boolean;
  pendingCount: number;
  maxFirstPush: number;
  confirmLargePush: boolean;
}): FirstPushCheck {
  if (opts.firstPushDone) return { hold: false, done: true };
  if (opts.pendingCount > opts.maxFirstPush && !opts.confirmLargePush) {
    return {
      hold: true,
      done: false,
      reason:
        `First push held: ${opts.pendingCount} pending changes exceed the ` +
        `first-push limit of ${opts.maxFirstPush}. Look at what is pending, ` +
        `then either raise maxFirstPush or set confirmLargePush: true in ` +
        `supervisor/config.json and restart to release it.`,
    };
  }
  return { hold: false, done: true };
}

// ── Guardrail 3: clock-skew detection (pure, tested directly) ──────────────

export type SkewClass = "ok" | "warn" | "hold";

/** abs(skewMs) classified against the two configured thresholds. */
export function classifySkew(skewMs: number, warnMs: number, holdMs: number): SkewClass {
  const abs = Math.abs(skewMs);
  if (abs >= holdMs) return "hold";
  if (abs >= warnMs) return "warn";
  return "ok";
}

// ── Push decision (pure, tested directly) ───────────────────────────────────
// Composes guardrails 1-3 into one place: given what THIS round could push
// (already-fetched candidates, so no DB access here) and the current guard
// state, decide what actually goes out. Pulling is never part of this
// decision — the caller runs the pull side unconditionally regardless of the
// result, which is what keeps a held/pull-only device pulling normally.
export type PushSelection = {
  ops: SyncOp[];
  holdReason: HoldReason | null;
  heldOpsCount: number | null;
  firstPushDoneAfter: boolean;
};

export function selectPushOps(opts: {
  mode: SyncMode;
  candidateOps: SyncOp[];
  pendingCount: number;
  firstPushDone: boolean;
  maxFirstPush: number;
  confirmLargePush: boolean;
  skewMs: number | null;
  skewWarnMs: number;
  skewHoldMs: number;
}): PushSelection {
  if (opts.mode === "pull-only") {
    // Guardrail 1: never send local ops, regardless of firstPushDone/skew.
    return { ops: [], holdReason: null, heldOpsCount: null, firstPushDoneAfter: opts.firstPushDone };
  }
  if (opts.skewMs !== null && classifySkew(opts.skewMs, opts.skewWarnMs, opts.skewHoldMs) === "hold") {
    // Guardrail 3: not limited to the first push — holds for as long as the
    // skew stays this bad, however many pushes in.
    return {
      ops: [],
      holdReason: "clock_skew",
      heldOpsCount: null,
      firstPushDoneAfter: opts.firstPushDone,
    };
  }
  const check = checkFirstPush({
    firstPushDone: opts.firstPushDone,
    pendingCount: opts.pendingCount,
    maxFirstPush: opts.maxFirstPush,
    confirmLargePush: opts.confirmLargePush,
  });
  if (check.hold) {
    return {
      ops: [],
      holdReason: "first_push_size",
      heldOpsCount: opts.pendingCount,
      firstPushDoneAfter: false,
    };
  }
  return { ops: opts.candidateOps, holdReason: null, heldOpsCount: null, firstPushDoneAfter: true };
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

type PushGuard = {
  mode: SyncMode;
  maxFirstPush: number;
  confirmLargePush: boolean;
  skewWarnMs: number;
  skewHoldMs: number;
};

// One full exchange with one hub: push until drained, pull until drained.
// Throws on any transport/HTTP failure so the caller can walk the hub list.
// Guardrails 1-3 all act at the same point: deciding what `ops` to send.
// Pulling is never gated by any of them (holding a push cannot corrupt the
// hub; holding a pull would just leave this peer stale).
async function exchangeWith(hub: string, deviceId: string, token: string, guard: PushGuard): Promise<void> {
  const schemaVer = latestSchemaVer();
  let cursor = await readCursor(hub);
  // Bounded loop: worst case both sides hold deep backlogs; each round moves
  // at least one batch, and the caller reruns on the next tick anyway.
  for (let round = 0; round < 20; round++) {
    // candidateOps is what would be sent absent any guard; selectPushOps
    // (pure) decides whether it actually goes out. Cheap enough to always
    // fetch — pull-only skips it outright since it can never be used.
    const pending = await pendingCount(cursor.push);
    const candidateOps = guard.mode === "pull-only" ? [] : await unpushedOps(cursor.push);
    const sel = selectPushOps({
      mode: guard.mode,
      candidateOps,
      pendingCount: pending,
      firstPushDone: shared.firstPushDone,
      maxFirstPush: guard.maxFirstPush,
      confirmLargePush: guard.confirmLargePush,
      skewMs: status.skewMs,
      skewWarnMs: guard.skewWarnMs,
      skewHoldMs: guard.skewHoldMs,
    });
    shared.firstPushDone = sel.firstPushDoneAfter;
    status.holdReason = sel.holdReason;
    status.heldOpsCount = sel.heldOpsCount;
    if (sel.holdReason === "first_push_size") {
      log.warn("first push held: pending oplog exceeds the first-push limit", {
        pending: sel.heldOpsCount,
        maxFirstPush: guard.maxFirstPush,
      });
    }
    const ops = sel.ops;

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
    if (res.status === 403) {
      // The hub-side belt-and-suspenders (a pull_only device that somehow
      // sent ops anyway). Never expected given the checks above, but surface
      // it rather than retry the same rejected push forever.
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? "hub refused this device's ops (pull-only)");
    }
    if (!res.ok) throw new Error(`sync exchange failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      ops: SyncOp[];
      cursor: number;
      hasMore: boolean;
      serverTime?: string;
    };
    if (data.ops.length > 0) {
      await applySyncOps(data.ops);
    }
    if (data.serverTime) {
      const skewMs = Date.parse(data.serverTime) - Date.now();
      if (Number.isFinite(skewMs)) {
        status.skewMs = skewMs;
        status.skewWarn = classifySkew(skewMs, guard.skewWarnMs, guard.skewHoldMs) !== "ok";
      }
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

async function exchange(hubs: string[], deviceId: string, token: string, guard: PushGuard): Promise<void> {
  for (let i = 0; i < hubs.length; i++) {
    try {
      await exchangeWith(hubs[i], deviceId, token, guard);
      status.activeHubIndex = i;
      status.lastSyncAt = new Date().toISOString();
      status.lastError = null;
      status.state = status.holdReason ? "held" : status.pendingOps > 0 ? "pending" : "synced";
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
  if (shared.loopArmed) return;
  const hubs = parseHubs(process.env.LEDGR_SYNC_HUBS);
  const token = process.env.LEDGR_SYNC_TOKEN;
  if (hubs.length === 0 || !token) return;
  shared.loopArmed = true;

  const pushDebounceMs = envInt("LEDGR_SYNC_PUSH_DEBOUNCE_MS", 2000);
  const pullMs = envInt("LEDGR_SYNC_PULL_MS", 10000);
  const guard: PushGuard = {
    mode: parseSyncMode(process.env.LEDGR_SYNC_MODE),
    maxFirstPush: envInt("LEDGR_SYNC_MAX_FIRST_PUSH", 500),
    confirmLargePush: /^(1|true)$/i.test(process.env.LEDGR_SYNC_CONFIRM_LARGE_PUSH ?? ""),
    skewWarnMs: envInt("LEDGR_SYNC_SKEW_WARN_MS", 5000),
    skewHoldMs: envInt("LEDGR_SYNC_SKEW_HOLD_MS", 60000),
  };

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
        await exchange(hubs, deviceId, token, guard);
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
