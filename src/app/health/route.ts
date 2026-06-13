import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getCalendarState } from "@/lib/calendar/sync";
import { getEmailState } from "@/lib/email/sync";
import { getExportState } from "@/lib/export/engine";
import { checkGraphAuth, type GraphHealth } from "@/lib/graph/client";
import { getPushState } from "@/lib/push/notify";
import { getTodoistState } from "@/lib/todoist/sync";
import { createLogger, isDebugMode } from "@/lib/log";

// /health: the canary endpoint (runbook.md §2). Checks DB reachability and
// the last clean export run; Todoist and Graph checks join it when those
// integrations exist.
export const dynamic = "force-dynamic";

type Check =
  | { ok: true; latencyMs: number }
  | { ok: false; detail: string };

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    createLogger("health").error("database check failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      detail:
        isDebugMode() && err instanceof Error
          ? err.message
          : "database unreachable",
    };
  }
}

// Captured failures from the last 24h (the no-silent-failures surface,
// rule 9). Counts always; messages only in debug mode.
type ErrorsCheck = {
  last24h: number;
  recent?: { source: string; message: string; at: string }[];
} | null;

async function checkErrors(): Promise<ErrorsCheck> {
  try {
    const res = await getDb().execute(sql`
      select source, message, created_at
      from error_log
      where created_at > now() - interval '24 hours'
      order by created_at desc
    `);
    const all = res.rows as { source: string; message: string; created_at: string }[];
    const out: ErrorsCheck = { last24h: all.length };
    if (isDebugMode()) {
      out.recent = all.slice(0, 5).map((r) => ({
        source: r.source,
        message: r.message,
        at: new Date(r.created_at).toISOString(),
      }));
    }
    return out;
  } catch {
    // error_log being unreadable while select 1 works is strange enough to
    // surface as null rather than fail the whole check.
    return null;
  }
}

export async function GET() {
  const database = await checkDatabase();

  // lastExportAt is the last run that finished clean (zero item errors,
  // nothing remaining); lastExportRunAt is the last attempt. A growing gap
  // between them, or a stale lastExportAt, is the stalled-export canary
  // (null until Brandon configures the Azure app registration, runbook §1).
  let lastExportAt: string | null = null;
  let lastExportRunAt: string | null = null;
  // Calendar sync canary (slice 22): lastSuccessAt is the last error-free run;
  // a stale value while lastRunAt advances means runs are failing partway, and
  // both null means the 6h GitHub Actions poll never reaches the endpoint or
  // Calendars.Read isn't granted yet (runbook §1c).
  let lastCalendarSyncAt: string | null = null;
  let lastCalendarRunAt: string | null = null;
  let lastTodoistSyncAt: string | null = null;
  let lastTodoistRunAt: string | null = null;
  let lastEmailImportAt: string | null = null;
  let lastEmailRunAt: string | null = null;
  // Push notification canaries (slice 30): the last morning-agenda send and the
  // last prep-ready run. Both null = the crons never reach the endpoint (no
  // LEDGR_CRON_TOKEN) or VAPID keys aren't set yet (runbook §1e, the 503 path).
  let lastAgendaNotifyAt: string | null = null;
  let lastPrepNotifyAt: string | null = null;
  let errors: ErrorsCheck = null;
  if (database.ok) {
    try {
      const state = await getExportState();
      lastExportAt = state?.lastSuccessAt ?? null;
      lastExportRunAt = state?.lastRunAt ?? null;
    } catch {
      // job_state being unreadable while select 1 works is strange enough
      // to surface as nulls rather than fail the whole check.
    }
    try {
      const cal = await getCalendarState();
      lastCalendarSyncAt = cal?.lastSuccessAt ?? null;
      lastCalendarRunAt = cal?.lastRunAt ?? null;
    } catch {
      // same posture as the export state read.
    }
    try {
      const td = await getTodoistState();
      lastTodoistSyncAt = td?.lastSuccessAt ?? null;
      lastTodoistRunAt = td?.lastRunAt ?? null;
    } catch {
      // same posture as the export state read.
    }
    try {
      const em = await getEmailState();
      lastEmailImportAt = em?.lastSuccessAt ?? null;
      lastEmailRunAt = em?.lastRunAt ?? null;
    } catch {
      // same posture as the export state read.
    }
    try {
      const push = await getPushState();
      lastAgendaNotifyAt = push.agenda?.lastSuccessAt ?? null;
      lastPrepNotifyAt = push.prep?.lastSuccessAt ?? null;
    } catch {
      // same posture as the export state read.
    }
    errors = await checkErrors();
  }

  // App-only Graph token grant (slice 21): a failed grant is the secret-expiry
  // / consent-revocation canary for every unattended Graph job (export, and
  // Phase 2 calendar + email-in). `{configured:false}` until the registration
  // exists; it never changes overall status, since Graph being down must not
  // make the app itself look unhealthy (Sunday-proof: the DB is what matters).
  let graph: GraphHealth = { configured: false };
  try {
    graph = await checkGraphAuth();
  } catch {
    // checkGraphAuth swallows its own errors; this is belt-and-suspenders.
  }

  return NextResponse.json(
    {
      status: database.ok ? "ok" : "degraded",
      checks: {
        database,
        lastExportAt,
        lastExportRunAt,
        lastCalendarSyncAt,
        lastCalendarRunAt,
        lastTodoistSyncAt,
        lastTodoistRunAt,
        lastEmailImportAt,
        lastEmailRunAt,
        lastAgendaNotifyAt,
        lastPrepNotifyAt,
        graph,
        errors,
      },
      timestamp: new Date().toISOString(),
    },
    { status: database.ok ? 200 : 503 }
  );
}
