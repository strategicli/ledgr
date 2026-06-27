// Weekly health check (slice 37, PRD §5.5 / §6.2): the scheduled self-monitor.
// A deterministic job — no model in the loop (Principle 3; the AI-authored
// "morning briefing" the PRD also imagines stays human-in-the-loop over MCP,
// and the daily count-summary agenda push, slice 30, is the morning briefing's
// deterministic form). This is its sibling: once a week it reads the same
// canaries `/health` exposes, decides what genuinely needs attention, and
// pushes Brandon only when something is wrong (Principle 9, no silent
// failures). When all is green it stays silent and just stamps a success.
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState } from "@/db/schema";
import { sendToOwner, type SendTally } from "@/lib/push/notify";
import type { PushSender } from "@/lib/push/types";
import type { HealthReport } from "@/lib/health";

export const HEALTH_CHECK_JOB_KEY = "health:check";

// How many days of captured errors the weekly check considers. The /health
// route surfaces a 24h window for at-a-glance use; the weekly cadence wants the
// whole interval so a Tuesday failure isn't invisible by the next run.
export const ERROR_WINDOW_DAYS = 7;

export type AlertSeverity = "critical" | "warn";
export type HealthAlert = { code: string; severity: AlertSeverity; message: string };

export type HealthCheckCanary = {
  lastRunAt: string | null;
  lastSuccessAt: string | null; // last run that found nothing wrong
  lastAlertAt: string | null;
  alerts: HealthAlert[]; // the most recent run's findings (empty when green)
};

type HealthCheckState = {
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastAlertAt?: string;
  alerts?: HealthAlert[];
};

// Per-integration freshness budget. We only alert on a *stalled* job — one that
// ran successfully before (its `run` canary is set) but whose last clean
// success is now older than `maxAgeHours`. A job that has never run (canary
// null) is unconfigured, not broken, so it stays quiet: Sunday-proofing and a
// deliberate don't-cry-wolf policy say an unset integration isn't an alert (this
// no longer leans on the now-ended alpha posture; behavior is unchanged). Budgets are a generous multiple of
// each job's cadence so a single missed poll doesn't page.
type FreshnessRule = {
  code: string;
  label: string;
  success: keyof HealthReport["checks"];
  run: keyof HealthReport["checks"];
  maxAgeHours: number;
};

const FRESHNESS: FreshnessRule[] = [
  { code: "export", label: "OneDrive export", success: "lastExportAt", run: "lastExportRunAt", maxAgeHours: 48 }, // nightly
  { code: "calendar", label: "Calendar sync", success: "lastCalendarSyncAt", run: "lastCalendarRunAt", maxAgeHours: 24 }, // 6h
  { code: "todoist", label: "Todoist sync", success: "lastTodoistSyncAt", run: "lastTodoistRunAt", maxAgeHours: 24 }, // 3h
  { code: "email", label: "Email import", success: "lastEmailImportAt", run: "lastEmailRunAt", maxAgeHours: 12 }, // 30min
  { code: "agenda", label: "Morning agenda", success: "lastAgendaNotifyAt", run: "lastAgendaNotifyAt", maxAgeHours: 48 }, // daily
];

function isStale(lastSuccess: string | null, now: Date, maxAgeHours: number): boolean {
  if (!lastSuccess) return true; // ran before (checked by caller) but never cleanly
  const ageMs = now.getTime() - new Date(lastSuccess).getTime();
  return ageMs > maxAgeHours * 3_600_000;
}

// Pure: turn a health snapshot + the recent-error count into the alert list.
// Deterministic and node-testable — the heart of the slice. Order is severity
// then declaration, so the push body leads with what matters most.
export function evaluateHealth(
  report: HealthReport,
  recentErrorCount: number,
  now: Date
): HealthAlert[] {
  const alerts: HealthAlert[] = [];

  // 1. The DB is the one thing that truly matters (Sunday-proof). Critical.
  if (!report.checks.database.ok) {
    alerts.push({ code: "database", severity: "critical", message: "Database is unreachable." });
  }

  // 2. Captured faults over the window (Principle 9). Health alerts themselves
  // are never written to error_log, so this can't feed back on itself.
  if (recentErrorCount > 0) {
    alerts.push({
      code: "errors",
      severity: "warn",
      message: `${recentErrorCount} error${recentErrorCount === 1 ? "" : "s"} captured in the last ${ERROR_WINDOW_DAYS} days.`,
    });
  }

  // 3. Graph token grant — the client-secret-expiry canary. Only when the
  // registration is configured (else it's a Brandon-step, not a fault).
  const graph = report.checks.graph;
  if (graph.configured && graph.ok === false) {
    alerts.push({
      code: "graph",
      severity: "warn",
      message: "Microsoft Graph token grant is failing (the client secret may have expired).",
    });
  }

  // 4. Stalled scheduled jobs — the §12 "GitHub Actions auto-disabled after 60
  // days of inactivity" failure mode, and any silently-wedged poll.
  for (const rule of FRESHNESS) {
    const ranBefore = report.checks[rule.run] as string | null;
    if (!ranBefore) continue; // never configured / never ran → quiet
    const lastSuccess = report.checks[rule.success] as string | null;
    if (isStale(lastSuccess, now, rule.maxAgeHours)) {
      alerts.push({
        code: rule.code,
        severity: "warn",
        message: `${rule.label} hasn't completed cleanly in over ${rule.maxAgeHours}h.`,
      });
    }
  }

  return alerts;
}

// Builds the single push notification for a non-empty alert list. Kept terse —
// the notification surface is small; "/health" has the detail (and the canary
// the route now exposes). The click opens Today.
export function buildAlertMessage(alerts: HealthAlert[]) {
  const critical = alerts.some((a) => a.severity === "critical");
  const lead = alerts
    .slice(0, 3)
    .map((a) => a.message)
    .join(" ");
  const more = alerts.length > 3 ? ` (+${alerts.length - 3} more)` : "";
  return {
    title: critical ? "Ledgr needs attention" : "Ledgr health check",
    body: `${lead}${more}`,
    url: "/",
    tag: "ledgr-health",
  } as const;
}

async function readState(): Promise<HealthCheckState> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, HEALTH_CHECK_JOB_KEY));
  return (rows[0]?.value as HealthCheckState) ?? {};
}

async function writeState(value: HealthCheckState): Promise<void> {
  await getDb()
    .insert(jobState)
    .values({ key: HEALTH_CHECK_JOB_KEY, value })
    .onConflictDoUpdate({ target: jobState.key, set: { value } });
}

export async function getHealthCheckState(): Promise<HealthCheckCanary> {
  const s = await readState();
  return {
    lastRunAt: s.lastRunAt ?? null,
    lastSuccessAt: s.lastSuccessAt ?? null,
    lastAlertAt: s.lastAlertAt ?? null,
    alerts: s.alerts ?? [],
  };
}

async function countRecentErrors(now: Date): Promise<number> {
  try {
    const since = new Date(now.getTime() - ERROR_WINDOW_DAYS * 24 * 3_600_000).toISOString();
    const res = await getDb().execute(
      sql`select count(*)::int as n from error_log where created_at > ${since}`
    );
    return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
  } catch {
    // error_log unreadable: don't manufacture an alert out of a read failure.
    return 0;
  }
}

// Runs the check. `report`/`recentErrorCount` are injectable for verification;
// in production they default to a live gather + a 7-day error count. `sender`
// may be null (VAPID unset, runbook §1e) — the run still evaluates and records
// its findings to job_state (which /health surfaces), it just can't push.
export async function runHealthCheck(
  ownerId: string,
  sender: PushSender | null,
  opts: { now?: Date; report?: HealthReport; recentErrorCount?: number } = {}
): Promise<{ alerts: HealthAlert[]; delivered: SendTally | null }> {
  const now = opts.now ?? new Date();
  const report = opts.report ?? (await (await import("@/lib/health")).gatherHealth());
  const recentErrorCount =
    opts.recentErrorCount ?? (await countRecentErrors(now));

  const alerts = evaluateHealth(report, recentErrorCount, now);
  const nowIso = now.toISOString();

  let delivered: SendTally | null = null;
  if (alerts.length > 0) {
    if (sender) {
      delivered = await sendToOwner(ownerId, sender, buildAlertMessage(alerts));
    }
    const prev = await readState();
    await writeState({ ...prev, lastRunAt: nowIso, lastAlertAt: nowIso, alerts });
  } else {
    const prev = await readState();
    await writeState({ ...prev, lastRunAt: nowIso, lastSuccessAt: nowIso, alerts: [] });
  }

  return { alerts, delivered };
}
