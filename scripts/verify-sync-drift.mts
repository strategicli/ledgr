// Verifies the sync drift alerts (src/lib/sync/drift.ts) and the health
// check's job-placement rule (a job another copy runs is judged by that copy's
// stamp, not this copy's stale times). Pure: no database, no network.
// Run: npx tsx scripts/verify-sync-drift.mts
const { evaluateDrift, decideDrift, MIN_WINDOW_MS } = await import("../src/lib/sync/drift");
const { evaluateHealth } = await import("../src/lib/health-check");
type HubDriftInput = import("../src/lib/sync/drift").HubDriftInput;
type HealthReport = import("../src/lib/health").HealthReport;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse("2026-10-08T12:00:00Z");

// A healthy daily hub: synced 20 hours ago, today's edits waiting.
function daily(over: Partial<HubDriftInput> = {}): HubDriftInput {
  return {
    url: "https://ledgr-teal.vercel.app",
    cadenceMs: DAY,
    onChange: false,
    livenessFloorMs: 7 * DAY,
    lastSuccessAt: NOW - 20 * H,
    trackedSince: NOW - 30 * DAY,
    consecutiveFails: 0,
    lastError: null,
    undrainedStreak: 0,
    parked: { count: 0, first: null },
    oldestWaitingAt: NOW - 19 * H,
    pushing: true,
    ...over,
  };
}
const codes = (h: HubDriftInput) => evaluateDrift(h, NOW).map((p) => p.code).sort().join(",");

// Normal daily lag is silent.
check("healthy daily hub: no alerts", codes(daily()) === "");
check("a day and a half since sync: still quiet", codes(daily({ lastSuccessAt: NOW - 36 * H })) === "");

// 1. missed
check("missed: 49h since last sync on a daily hub", codes(daily({ lastSuccessAt: NOW - 49 * H, oldestWaitingAt: null })) === "missed");
check("missed: never synced, watched for 3 days", codes(daily({ lastSuccessAt: null, trackedSince: NOW - 3 * DAY, oldestWaitingAt: null })) === "missed");
check("missed: on-change hub, quiet 3 days, waits for its liveness floor", codes(daily({ onChange: true, lastSuccessAt: NOW - 3 * DAY, oldestWaitingAt: null })) === "");
check("missed: on-change hub past floor + window", codes(daily({ onChange: true, lastSuccessAt: NOW - 9 * DAY, oldestWaitingAt: null })) === "missed");
check("missed: continuous hub uses the 30-minute floor, not 20 seconds", codes(daily({ cadenceMs: 10_000, lastSuccessAt: NOW - 45 * 60_000, oldestWaitingAt: null })) === "");
check("missed: continuous hub past twice the floor", codes(daily({ cadenceMs: 10_000, lastSuccessAt: NOW - 2 * MIN_WINDOW_MS - 60_000, oldestWaitingAt: null })) === "missed");

// 2. failing
check("failing: 2 fails is a blip", codes(daily({ consecutiveFails: 2 })) === "");
const failing = evaluateDrift(daily({ consecutiveFails: 3, lastError: "sync exchange failed: HTTP 500" }), NOW);
check("failing: 3 in a row alerts with the error", failing.length === 1 && failing[0].code === "failing" && failing[0].body.includes("HTTP 500"));

// 3. refused
const refused = evaluateDrift(daily({ parked: { count: 2, first: "upsert on items: value too long" } }), NOW);
check("refused: parked changes alert with the first", refused[0]?.code === "refused" && refused[0].title.includes("2 changes") && refused[0].body.includes("value too long"));

// 4. not catching up
check("not-catching-up: one undrained sync is fine", codes(daily({ undrainedStreak: 1 })) === "");
check("not-catching-up: two in a row alerts", codes(daily({ undrainedStreak: 2 })) === "not-catching-up");

// 5. waiting (Brandon's addition: a change older than twice the window)
check("waiting: 47h-old change on a daily hub is fine", codes(daily({ oldestWaitingAt: NOW - 47 * H })) === "");
check("waiting: 49h-old change alerts", codes(daily({ oldestWaitingAt: NOW - 49 * H })) === "waiting");
check("waiting: pull-only copies never alert", codes(daily({ pushing: false, oldestWaitingAt: NOW - 9 * DAY })) === "");

// Announce once, recover once, refusals every time.
const p1 = evaluateDrift(daily({ consecutiveFails: 5 }), NOW);
const d1 = decideDrift(p1, {}, NOW);
check("decide: a new problem is announced", d1.announce.length === 1 && !!d1.open.failing && !d1.recovered);
const d2 = decideDrift(p1, d1.open, NOW + H);
check("decide: a standing problem is not re-announced", d2.announce.length === 0 && d2.open.failing === d1.open.failing);
const d3 = decideDrift([], d2.open, NOW + 2 * H);
check("decide: clearing sends one recovery", d3.recovered && Object.keys(d3.open).length === 0);
const d4 = decideDrift([], {}, NOW + 3 * H);
check("decide: nothing open, nothing to say", !d4.recovered && d4.announce.length === 0);
const d5 = decideDrift(refused, {}, NOW);
const d6 = decideDrift(refused, d5.open, NOW + H);
check("decide: each refusal is news, never held open", d5.announce.length === 1 && d6.announce.length === 1 && !d6.recovered);

// ── Health check: jobs another copy runs ─────────────────────────────────────
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();
function cloudReport(jobs: HealthReport["checks"]["jobs"]): HealthReport {
  return {
    status: "ok",
    checks: {
      database: { ok: true, latencyMs: 5 },
      // The cloud copy's own times: weeks stale, because the hub runs these.
      lastExportAt: iso(1100),
      lastExportRunAt: iso(1000),
      lastExportRemaining: 66,
      lastCalendarSyncAt: iso(1000),
      lastCalendarRunAt: iso(1000),
      tasksAdapter: "native",
      transcription: "none",
      lastTodoistSyncAt: null,
      lastTodoistRunAt: null,
      lastEmailImportAt: iso(1000),
      lastEmailRunAt: iso(1000),
      lastAgendaNotifyAt: null,
      lastPrepNotifyAt: null,
      lastRelatednessRunAt: iso(3),
      mcp: { configured: true, hasToken: true, ownerResolves: true },
      graph: { configured: true, ok: true },
      github: { configured: true, ok: true, repo: "strategicli/ledgr" },
      healthCheck: { lastRunAt: null, lastSuccessAt: null, lastAlertAt: null, alerts: [] },
      schema: { state: "current", pending: [], total: 72 },
      sync: { enabled: false },
      errors: { last24h: 0 },
      jobs,
    },
    timestamp: new Date(NOW).toISOString(),
  };
}
const onHub = { runsHere: false, runsOn: "BrandonECC", lastRunAt: iso(2), warning: null };
const alertsFor = (r: HealthReport) => evaluateHealth(r, 0, new Date(NOW)).map((a) => a.code).sort().join(",");

check("health: without placements the old rule still alerts", alertsFor(cloudReport(undefined)) === "calendar,email,export");
check(
  "health: jobs the hub runs are not judged by the cloud's stale times",
  alertsFor(cloudReport({ export: onHub, "calendar-sync": onHub, "email-import": onHub })) === ""
);
const stale = evaluateHealth(
  cloudReport({
    export: onHub,
    "calendar-sync": { ...onHub, lastRunAt: iso(100), warning: "Calendar sync last ran 4 days ago on BrandonECC. That machine is probably switched off." },
    "email-import": onHub,
  }),
  0,
  new Date(NOW)
);
check("health: the owner going quiet alerts with its own sentence", stale.length === 1 && stale[0].code === "calendar" && stale[0].message.includes("BrandonECC"));
check(
  "health: a job this copy runs is still judged by its own times",
  alertsFor(cloudReport({ export: { runsHere: true, runsOn: "this copy", lastRunAt: null, warning: null }, "calendar-sync": onHub, "email-import": onHub })) === "export"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
