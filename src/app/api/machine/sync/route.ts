import { NextResponse } from "next/server";
import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { syncOps, syncPeers } from "@/db/schema";
import { verifySyncDevice } from "@/lib/sync/auth";
import { latestSchemaVer } from "@/lib/sync/version";
import { versionGate, type SyncOp } from "@/lib/sync/engine";
import { applySyncOps } from "@/lib/sync/apply";
import { pullOnlyRejectsPush } from "@/lib/sync/peers";
import { captureError, createLogger, errorMessage } from "@/lib/log";

// The hub side of the sync spine (plans/local-hub-idea-to-cutover.html,
// phase 1): one POST = one exchange. The peer pushes its ops since our last
// sight of it and pulls ours since its cursor. Auth is a DB-backed device
// token (sync_peers, plan decision 15) — the same public-matcher door as the
// other /api/machine routes, verified in the handler, never Clerk.
export const dynamic = "force-dynamic";
// A full 500-op batch on the neon-http driver is hundreds of round trips.
export const maxDuration = 60;

// Response batch cap; the client loops while hasMore.
const PULL_BATCH = 500;

type SyncRequest = {
  deviceId?: string;
  schemaVer?: string;
  sinceSeq?: number;
  ops?: SyncOp[];
};

export async function POST(request: Request) {
  const peer = await verifySyncDevice(request.headers.get("authorization"));
  if (!peer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const log = createLogger("sync");
  let body: SyncRequest;
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Version gate FIRST: peers exchange ops only on identical bundled journal
  // tags. The 409 carries both versions — the stale side's update card reads
  // it (phase 5).
  const localVer = latestSchemaVer();
  if (!body.schemaVer || !versionGate(localVer, body.schemaVer)) {
    return NextResponse.json(
      { error: "schema version mismatch", localVer, remoteVer: body.schemaVer ?? null },
      { status: 409 }
    );
  }

  const ops = Array.isArray(body.ops) ? body.ops : [];
  const sinceSeq = Number.isFinite(body.sinceSeq) ? Number(body.sinceSeq) : 0;

  // Guardrail 1, hub side: a pull_only device is refused outright rather than
  // silently dropped, so the guarantee never depends on the spoke behaving
  // (a bug or a misconfigured spoke can't push around it).
  if (pullOnlyRejectsPush(peer.pullOnly, ops.length)) {
    log.warn("pull-only device attempted to push ops", { peer: peer.name, count: ops.length });
    return NextResponse.json(
      { error: "this device is pull-only; it cannot push changes" },
      { status: 403 }
    );
  }

  try {
    const db = getDb();
    const result = await applySyncOps(ops);
    if (result.rejected > 0) {
      // Owner-scope or unknown-table refusals are visible, never silent.
      log.warn("sync ops rejected", { peer: peer.name, rejected: result.rejected });
    }

    // Record the peer's push cursor + liveness. The identity is the
    // AUTHENTICATED row, never the body's claimed deviceId.
    const maxPushed = ops.reduce((m, o) => Math.max(m, o.seq ?? 0), 0);
    await db
      .update(syncPeers)
      .set({
        lastSeenAt: new Date(),
        lastPushedSeq: sql`greatest(${syncPeers.lastPushedSeq}, ${maxPushed})`,
      })
      .where(eq(syncPeers.deviceId, peer.deviceId));

    // Pull: our ops the peer hasn't seen, minus echoes of its own writes
    // (origin_device_id stamped by the apply layer where the driver allows).
    const rows = await db
      .select()
      .from(syncOps)
      .where(
        and(
          gt(syncOps.seq, sinceSeq),
          or(isNull(syncOps.originDeviceId), ne(syncOps.originDeviceId, peer.deviceId))
        )
      )
      .orderBy(syncOps.seq)
      .limit(PULL_BATCH);
    const hasMore = rows.length === PULL_BATCH;
    // When the batch is capped, the cursor stops at the last included op so
    // the caller's loop misses nothing; otherwise it jumps to the head so
    // filtered-out echoes aren't rescanned forever.
    let cursor = rows.length > 0 ? rows[rows.length - 1].seq : sinceSeq;
    if (!hasMore) {
      const head = await db
        .select({ max: sql<string>`coalesce(max(${syncOps.seq}), 0)::text` })
        .from(syncOps);
      cursor = Math.max(cursor, Number(head[0]?.max ?? 0));
    }
    await db
      .update(syncPeers)
      .set({ lastPulledSeq: cursor })
      .where(eq(syncPeers.deviceId, peer.deviceId));

    return NextResponse.json({
      ops: rows.map((r) => ({
        seq: r.seq,
        deviceId: r.deviceId,
        originDeviceId: r.originDeviceId,
        ownerId: r.ownerId,
        at: r.at.toISOString(),
        tbl: r.tbl,
        rowId: r.rowId,
        kind: r.kind,
        changed: r.changed,
        schemaVer: r.schemaVer,
      })),
      cursor,
      hasMore,
      schemaVer: localVer,
      applied: result.actions,
      rejected: result.rejected,
      // Guardrail 3: additive field so existing callers are unaffected. The
      // client compares this to its own clock to detect skew.
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const message = errorMessage(err);
    await captureError("sync", err, { correlationId: log.correlationId });
    log.error("sync exchange failed", { message, peer: peer.name });
    return NextResponse.json(
      { ok: false, correlationId: log.correlationId, error: message },
      { status: 500 }
    );
  }
}
