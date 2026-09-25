// Health gathering (slice 37): the structured health snapshot the `/health`
// route returns AND the weekly health-check scheduled task evaluates. Extracted
// from the route so there's one source of truth — the self-monitoring job reads
// the same canaries in-process rather than calling its own HTTP endpoint
// (cleaner than the PRD §6.2 "hits /health" phrasing, and it still works when
// routing itself is the problem).
//
// Modules bring their own canaries (the healthCheck slot, ADR-272 step 3): this
// file runs the core checks, then each enabled module's check, and reports
// those under `checks.modules[<module id>]`. The feature areas below that are
// not modules yet still read here directly, in the marked block; each moves
// onto its manifest when step 4 makes it a module. Their top-level keys stay
// exactly as they are, because the weekly check and outside readers depend on
// them.
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { hasActiveCredential } from "@/lib/auth/credentials";
import { hasScopedToken } from "@/lib/auth/machine";
import { resolveMcpOwner } from "@/lib/mcp/owner";
import { checkGraphAuth, type GraphHealth } from "@/lib/graph/client";
import { checkGithub, type GithubHealth } from "@/lib/github/client";
import { getHealthCheckState, type HealthCheckCanary } from "@/lib/health-check";
import { allModules } from "@/lib/modules";
import { moduleOn } from "@/lib/modules/enabled";
// Attaches each module's server-only healthCheck onto its manifest.
import "@/lib/modules/server-slots";
import { getSettings } from "@/lib/settings";
import { getSchemaStatus, type SchemaStatus } from "@/lib/updates";
import { createLogger, isDebugMode } from "@/lib/log";
// not yet modules (step 4): calendar, email, push, discovery,
// sync, tasks adapter, transcription adapter.
import { getCalendarState } from "@/lib/calendar/sync";
import { getEmailState } from "@/lib/email/sync";
import { getRelatednessState } from "@/lib/discovery/refresh";
import { getPushState } from "@/lib/push/notify";
import { gatherSyncStatus, type SyncState } from "@/lib/sync/client";
import { tasksAdapter, type TasksAdapterId } from "@/lib/tasks/provider";
import { transcriptionAdapter, type TranscriptionAdapterId } from "@/lib/transcription/provider";

export type DatabaseCheck =
  | { ok: true; latencyMs: number }
  | { ok: false; detail: string };

export type ErrorsCheck = {
  last24h: number;
  recent?: { source: string; message: string; at: string }[];
} | null;

export type McpCanary = { configured: boolean; hasToken: boolean; ownerResolves: boolean };

// The hub/spoke sync canary (ADR-206 phase 3). {enabled: false} on any
// instance that isn't a sync spoke (the cloud hub, Tyler's) — cheap, env-only.
export type SyncCanary =
  | { enabled: false }
  | { enabled: true; state: SyncState; pendingOps: number; lastSyncAt: string | null };

export type HealthReport = {
  status: "ok" | "degraded";
  checks: {
    database: DatabaseCheck;
    lastExportAt: string | null;
    lastExportRunAt: string | null;
    lastExportRemaining: number | null;
    lastCalendarSyncAt: string | null;
    lastCalendarRunAt: string | null;
    // The active tasks adapter (ADR-081): "native" (default — Ledgr owns tasks,
    // no sync) or "todoist" (the optional sync). The lastTodoist* fields below
    // are only meaningful when the adapter is "todoist".
    tasksAdapter: TasksAdapterId;
    // The active transcription adapter (ADR-088): "none" (paste-only, the v1a
    // default) or "assemblyai" (audio upload → auto-transcribe enabled).
    transcription: TranscriptionAdapterId;
    lastTodoistSyncAt: string | null;
    lastTodoistRunAt: string | null;
    lastEmailImportAt: string | null;
    lastEmailRunAt: string | null;
    lastAgendaNotifyAt: string | null;
    lastPrepNotifyAt: string | null;
    // Last successful nightly relatedness-cache refresh (Discover, ADR-127).
    lastRelatednessRunAt: string | null;
    mcp: McpCanary;
    graph: GraphHealth;
    github: GithubHealth;
    healthCheck: HealthCheckCanary;
    // Migration currency (the /build/updates schema axis, surfaced here too so
    // a machine check can see a code-ahead-of-database gap).
    schema: SchemaStatus;
    sync: SyncCanary;
    errors: ErrorsCheck;
    // Each enabled module's own canaries, keyed by module id (ADR-272 step 3).
    // Present only when at least one module reported, so an instance with no
    // such module on returns exactly the shape it always did.
    modules?: Record<string, Record<string, unknown>>;
  };
  timestamp: string;
};

async function checkDatabase(): Promise<DatabaseCheck> {
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
        isDebugMode() && err instanceof Error ? err.message : "database unreachable",
    };
  }
}

// Captured failures from the last 24h (the no-silent-failures surface,
// rule 9). Counts always; messages only in debug mode.
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

// One canary read. A state row being unreadable while `select 1` works is
// strange enough to surface as nulls rather than fail the whole check, so a
// throw becomes undefined and the caller falls back to null.
async function safe<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

// The healthCheck slot: every module that is on for the owner and declares a
// check runs it, one at a time. A module that throws reports an error under its
// own id and never touches the others or the core checks.
async function checkModules(ownerId: string): Promise<Record<string, Record<string, unknown>>> {
  const settings = await getSettings(ownerId);
  const out: Record<string, Record<string, unknown>> = {};
  for (const m of allModules()) {
    if (!m.healthCheck || !moduleOn(settings, m.id)) continue;
    try {
      out[m.id] = await m.healthCheck(ownerId);
    } catch (err) {
      out[m.id] = { error: isDebugMode() && err instanceof Error ? err.message : "check failed" };
    }
  }
  return out;
}

// One read of every canary. `status` is "degraded" only when the DB is down —
// integrations being unconfigured or stalled must never make the app itself
// look unhealthy (Sunday-proof: the DB is what matters). The weekly health
// check layers its own, stricter alerting on top of this snapshot.
export async function gatherHealth(): Promise<HealthReport> {
  const database = await checkDatabase();

  let mcp: McpCanary = { configured: false, hasToken: false, ownerResolves: false };
  let healthCheck: HealthCheckCanary = { lastRunAt: null, lastSuccessAt: null, lastAlertAt: null, alerts: [] };
  let errors: ErrorsCheck = null;
  let modules: Record<string, Record<string, unknown>> = {};
  // not yet modules (step 4): each read below moves onto its module's manifest.
  let cal, em, push, rel;
  if (database.ok) {
    cal = await safe(getCalendarState);
    em = await safe(getEmailState);
    push = await safe(getPushState);
    rel = await safe(getRelatednessState);
    const owner = await safe(resolveMcpOwner);
    // Either credential path counts as "a token exists" (ADR-224): the static
    // env entry, or a live minted credential carrying `mcp`.
    const hasToken = await safe(async () => hasScopedToken("mcp") || (await hasActiveCredential("mcp")));
    if (owner !== undefined && hasToken !== undefined) {
      mcp = { configured: hasToken && !!owner, hasToken, ownerResolves: !!owner };
    }
    healthCheck = (await safe(getHealthCheckState)) ?? healthCheck;
    errors = await checkErrors();
    if (owner) modules = (await safe(() => checkModules(owner))) ?? {};
  }

  // App-only Graph token grant (slice 21): a failed grant is the secret-expiry
  // / consent-revocation canary for every unattended Graph job. `{configured:
  // false}` until the registration exists; it never changes overall status,
  // since Graph being down must not make the app itself look unhealthy.
  // checkGraphAuth swallows its own errors; `safe` is belt-and-suspenders.
  const graph: GraphHealth = (await safe(checkGraphAuth)) ?? { configured: false };

  // GitHub canary (changelog + collab notes): a failed repo read is the
  // token-expiry / wrong-repo signal. Like Graph, it never changes overall
  // status — GitHub being down must not make the app itself look unhealthy.
  const github: GithubHealth = (await safe(checkGithub)) ?? { configured: false };

  // Migration currency. getSchemaStatus never throws (it reports "unknown"),
  // and it degrades to "unknown" on its own when the DB is down.
  const schema = await getSchemaStatus();

  // Sync canary: env-only {enabled: false} on non-spokes; two small oplog
  // reads on a spoke. Never changes overall status — sync being behind must
  // not make the app itself look unhealthy (same posture as Graph/GitHub).
  const s = await safe(gatherSyncStatus);
  const syncCheck: SyncCanary = s?.enabled
    ? { enabled: true, state: s.state, pendingOps: s.pendingOps, lastSyncAt: s.lastSyncAt }
    : { enabled: false };

  // Todoist is a module now (step 4): its canary arrives through the
  // healthCheck slot, and is copied into the two top-level keys the weekly
  // check and outside readers still read. Null while the module is off.
  const td = modules.todoist as { lastSyncAt?: string | null; lastRunAt?: string | null } | undefined;
  // OneDrive export is a module too (step 4), copied the same way into its
  // three top-level keys. Null while the module is off, which the weekly check
  // reads as "never ran" and does not alert on.
  const exp = modules["onedrive-export"] as
    | { lastSuccessAt?: string | null; lastRunAt?: string | null; remaining?: number | null }
    | undefined;

  return {
    status: database.ok ? "ok" : "degraded",
    checks: {
      database,
      lastExportAt: exp?.lastSuccessAt ?? null,
      lastExportRunAt: exp?.lastRunAt ?? null,
      lastExportRemaining: exp?.remaining ?? null,
      lastCalendarSyncAt: cal?.lastSuccessAt ?? null,
      lastCalendarRunAt: cal?.lastRunAt ?? null,
      tasksAdapter: tasksAdapter(),
      transcription: transcriptionAdapter(),
      lastTodoistSyncAt: td?.lastSyncAt ?? null,
      lastTodoistRunAt: td?.lastRunAt ?? null,
      lastEmailImportAt: em?.lastSuccessAt ?? null,
      lastEmailRunAt: em?.lastRunAt ?? null,
      lastAgendaNotifyAt: push?.agenda?.lastSuccessAt ?? null,
      lastPrepNotifyAt: push?.prep?.lastSuccessAt ?? null,
      lastRelatednessRunAt: rel?.lastRunAt ?? null,
      mcp,
      graph,
      github,
      healthCheck,
      schema,
      sync: syncCheck,
      errors,
      ...(Object.keys(modules).length > 0 ? { modules } : {}),
    },
    timestamp: new Date().toISOString(),
  };
}
