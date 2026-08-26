// Verification for the local-peer supervisor (LH2, ADR-206 decision 6) and
// the localAuthProvider selection rule (plan decision 5). Everything here is
// PURE on purpose: the supervisor's decisions (config validation, the
// keep-last-good pointer flip, npm-ci-only-on-lockfile-change, prune-to-2,
// backoff, env assembly) live in supervisor/lib.mjs precisely so this script
// can exercise them with no Postgres, no git, and no child processes; the
// spawn shell in ledgr-supervisor.mjs stays thin and untested.
//
// NOTE this file must never contain the literal name of the database
// connection env var — verify-ci.mjs classifies any script mentioning it as
// backend-needing and would silently drop this suite from CI. Hence DB_KEY.
//
// Run: npx tsx scripts/verify-supervisor.mts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assembleAppEnv,
  buildDbUrl,
  decideFlip,
  lockPath,
  lockVerdict,
  needsNpmCi,
  nextBackoffMs,
  normalizeConfig,
  parseLivePointer,
  pruneList,
  serializeLivePointer,
  parseStartupRequest,
  serializeStartupRequest,
  parseStartupState,
  serializeStartupState,
  startupSignalPath,
  startupStatePath,
  stopSignalPath,
  LOCAL_JOBS,
  normalizeCrons,
  parseDailyAt,
  nextDailyAt,
  nextRunAt,
  initialDueAt,
  jobStaleness,
  serializeCronState,
  parseCronState,
  localCronTokenEntry,
  CRON_RETRY_MS,
  CRON_STARTUP_GRACE_MS,
} from "../supervisor/lib.mjs";
import { chooseAuthProvider } from "../src/lib/auth/local";

const DB_KEY = ["DATABASE", "URL"].join("_");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ── (1) Config parsing / validation ──────────────────────────────────────────

const goodRaw = {
  role: "spoke",
  dataDir: "/data/ledgr",
  ownerEmail: "brandon@example.com",
  hubs: ["https://hub.example.com"],
  deviceToken: "tok",
  update: { mode: "prompted", pollIntervalMs: 900000 },
  cadence: { pushDebounceMs: 2500, pullMs: 12000 },
};
const cfg = normalizeConfig(goodRaw, "/repo/supervisor");

check("a valid config normalizes", cfg.role === "spoke" && cfg.ownerEmail === "brandon@example.com");
check("dataDir stays absolute", cfg.dataDir === "/data/ledgr");
// resolve() rather than a literal so the check holds on win32 too (where
// resolving "/repo/supervisor/.." gains a drive letter).
check(
  "repoDir defaults to the repo the supervisor lives in",
  cfg.repoDir === resolve("/repo/supervisor", "..")
);
check("ports default sanely", cfg.appPort === 3000 && cfg.dbPort === 5433);
check("cadence knobs are read", cfg.cadence.pushDebounceMs === 2500 && cfg.cadence.pullMs === 12000);
check("update mode + poll interval are read", cfg.update.mode === "prompted" && cfg.update.pollIntervalMs === 900000);

check("missing dataDir is refused", throws(() => normalizeConfig({ ownerEmail: "a@b.c" }, "/x")));
check("missing ownerEmail is refused", throws(() => normalizeConfig({ dataDir: "/d" }, "/x")));
check(
  "a bogus role is refused",
  throws(() => normalizeConfig({ ...goodRaw, role: "server" }, "/x"))
);
check(
  "a bogus update mode is refused",
  throws(() => normalizeConfig({ ...goodRaw, update: { mode: "yolo" } }, "/x"))
);
check("syncMode defaults to full", cfg.syncMode === "full");
check(
  "syncMode: pull-only is accepted",
  normalizeConfig({ ...goodRaw, syncMode: "pull-only" }, "/x").syncMode === "pull-only"
);
check(
  "a bogus syncMode is refused",
  throws(() => normalizeConfig({ ...goodRaw, syncMode: "read-write" }, "/x"))
);
check(
  "syncGuardrails default sanely",
  cfg.syncGuardrails.maxFirstPush === 500 &&
    cfg.syncGuardrails.confirmLargePush === false &&
    cfg.syncGuardrails.skewWarnMs === 5000 &&
    cfg.syncGuardrails.skewHoldMs === 60000
);
check(
  "syncGuardrails are read from config",
  normalizeConfig(
    { ...goodRaw, syncGuardrails: { maxFirstPush: 50, confirmLargePush: true, skewWarnMs: 1000, skewHoldMs: 5000 } },
    "/x"
  ).syncGuardrails.maxFirstPush === 50
);
check(
  "a bogus port is refused",
  throws(() => normalizeConfig({ ...goodRaw, appPort: "eighty" }, "/x"))
);
check(
  "defaults fill for the optional knobs",
  (() => {
    const minimal = normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c" }, "/x");
    return (
      minimal.role === "spoke" &&
      minimal.update.mode === "prompted" &&
      minimal.cadence.pushDebounceMs === 2000 &&
      minimal.cadence.pullMs === 10000 &&
      minimal.hubs.length === 0
    );
  })()
);

// ── (2) Env assembly ─────────────────────────────────────────────────────────

const env = assembleAppEnv(cfg, "abc1234def") as Record<string, string>;
check("app env points the DB at the local cluster", env[DB_KEY] === buildDbUrl(cfg) && env[DB_KEY].includes("127.0.0.1:5433"));
check("the build sha is stamped (the ADR-194 currency gap)", env.LEDGR_BUILD_SHA === "abc1234def");
check("the local owner identity is passed", env.LEDGR_LOCAL_OWNER_EMAIL === "brandon@example.com");
check("the supervisor signal dir is passed", env.LEDGR_SUPERVISOR_DIR === "/data/ledgr");
check(
  "self-update is on (the supervisor migrates before the swap)",
  env.LEDGR_SELF_UPDATE === "on"
);
check(
  "the tracked branch reaches the app, so Updates asks about the ref we build",
  env.GITHUB_BRANCH === cfg.branch &&
    (assembleAppEnv(
      normalizeConfig({ ...goodRaw, branch: "prod-brandon" }, "/x"),
      "s"
    ) as Record<string, string>).GITHUB_BRANCH === "prod-brandon"
);
check(
  "sync vars arrive from config",
  env.LEDGR_SYNC_HUBS === "https://hub.example.com" && env.LEDGR_SYNC_TOKEN === "tok"
);
check(
  "cadence knobs land as sync env",
  env.LEDGR_SYNC_PUSH_DEBOUNCE_MS === "2500" && env.LEDGR_SYNC_PULL_MS === "12000"
);
check("syncMode lands as sync env", env.LEDGR_SYNC_MODE === "full");
check(
  "guardrail knobs land as sync env",
  env.LEDGR_SYNC_MAX_FIRST_PUSH === "500" &&
    env.LEDGR_SYNC_CONFIRM_LARGE_PUSH === "false" &&
    env.LEDGR_SYNC_SKEW_WARN_MS === "5000" &&
    env.LEDGR_SYNC_SKEW_HOLD_MS === "60000"
);
check(
  "no hubs (or no token) means NO half-armed sync env",
  (() => {
    const e = assembleAppEnv(
      normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c" }, "/x"),
      "sha"
    ) as Record<string, string>;
    return (
      !("LEDGR_SYNC_HUBS" in e) &&
      !("LEDGR_SYNC_TOKEN" in e) &&
      !("LEDGR_SYNC_MODE" in e) &&
      !("LEDGR_SYNC_MAX_FIRST_PUSH" in e)
    );
  })()
);
check(
  "extraEnv passes through verbatim",
  (assembleAppEnv(
    normalizeConfig({ ...goodRaw, extraEnv: { R2_BUCKET: "b" } }, "/x"),
    "s"
  ) as Record<string, string>).R2_BUCKET === "b"
);

// ── (3) The live pointer + keep-last-good flip ───────────────────────────────

check(
  "a written pointer round-trips",
  (() => {
    const p = parseLivePointer(serializeLivePointer("/data/builds/abc", "abc"));
    return p !== null && p.dir === "/data/builds/abc" && p.sha === "abc";
  })()
);
check("garbage pointer text reads as no live build", parseLivePointer("not json{") === null);
check("a pointer missing its sha reads as no live build", parseLivePointer('{"dir":"/x"}') === null);

check("build ok + migrate ok flips", decideFlip({ buildOk: true, migrateOk: true }) === "flip");
check(
  "A FAILED MIGRATE KEEPS THE LAST GOOD BUILD (the whole point)",
  decideFlip({ buildOk: true, migrateOk: false }) === "keep"
);
check("a failed build keeps the last good build", decideFlip({ buildOk: false, migrateOk: false }) === "keep");
check(
  "undefined outcomes keep, never flip (fail closed)",
  decideFlip({ buildOk: undefined, migrateOk: undefined }) === "keep"
);

// ── (4) npm ci only when the lockfile changed ────────────────────────────────

check("same lockfile hash skips npm ci", needsNpmCi("aaa", "aaa") === false);
check("a changed lockfile hash requires npm ci", needsNpmCi("aaa", "bbb") === true);
check("no previous build requires npm ci", needsNpmCi(null, "bbb") === true);

// ── (5) Prune to the last 2 builds ───────────────────────────────────────────

const builds = [
  { sha: "old1", mtimeMs: 100 },
  { sha: "old2", mtimeMs: 200 },
  { sha: "prev", mtimeMs: 300 },
  { sha: "live", mtimeMs: 400 },
];
check(
  "prune keeps the live build and the newest fallback, drops the rest",
  JSON.stringify(pruneList(builds, "live").sort()) === JSON.stringify(["old1", "old2"])
);
check(
  "the live build is kept even when it is not the newest",
  !pruneList(builds, "old1").includes("old1")
);
check("one build prunes nothing", pruneList([{ sha: "live", mtimeMs: 1 }], "live").length === 0);
check("two builds prune nothing", pruneList(builds.slice(2), "live").length === 0);

// ── (6) Crash backoff ────────────────────────────────────────────────────────

check("first crash restarts fast", nextBackoffMs(0) === 1000);
check("backoff grows exponentially", nextBackoffMs(3) === 8000);
check("backoff caps at 60s", nextBackoffMs(20) === 60000);

// ── (7) localAuthProvider selection (plan decision 5, ADR-184 held) ─────────

const baseEnv = {
  clerkConfigured: false,
  deployed: false,
  localOwnerEmail: undefined as string | undefined,
  nodeEnv: "production" as string | undefined,
  devUserEmail: undefined as string | undefined,
};

check(
  "a configured Clerk always wins (hubs keep Clerk)",
  chooseAuthProvider({ ...baseEnv, clerkConfigured: true, localOwnerEmail: "a@b.c" }) === "clerk"
);
check(
  "local mode: owner email set, no Clerk, not deployed → local, in production builds",
  chooseAuthProvider({ ...baseEnv, localOwnerEmail: "a@b.c" }) === "local"
);
check(
  "A DEPLOYED VERCEL ENV NEVER FALLS INTO LOCAL MODE (ADR-184 fail-closed)",
  chooseAuthProvider({ ...baseEnv, deployed: true, localOwnerEmail: "a@b.c" }) === "null"
);
check(
  "the dev stand-in is unchanged (development + DEV_USER_EMAIL)",
  chooseAuthProvider({ ...baseEnv, nodeEnv: "development", devUserEmail: "d@e.f" }) === "dev"
);
check(
  "local outranks the dev stand-in when both are set",
  chooseAuthProvider({
    ...baseEnv,
    nodeEnv: "development",
    devUserEmail: "d@e.f",
    localOwnerEmail: "a@b.c",
  }) === "local"
);
check(
  "nothing configured means nobody is signed in",
  chooseAuthProvider(baseEnv) === "null"
);
check(
  "DEV_USER_EMAIL alone does nothing in production (the old gate holds)",
  chooseAuthProvider({ ...baseEnv, devUserEmail: "d@e.f" }) === "null"
);

// ── (8) Structural guards ────────────────────────────────────────────────────

check("the supervisor entrypoint exists", existsSync("supervisor/ledgr-supervisor.mjs"));

// The update path is in the untested spawn shell, so this is a structural
// tripwire rather than a behavioral test — but the regression it guards is one
// that ships unreleased code silently, which is worth a grep. `repoDir`
// defaults to the checkout the supervisor lives in, so on a builder's machine
// HEAD is whatever branch somebody last checked out. Resolving the target from
// `origin/<branch>` is what makes that irrelevant; a `git pull` followed by
// `rev-parse HEAD` is the shape that only worked by coincidence.
{
  const shell = readFileSync("supervisor/ledgr-supervisor.mjs", "utf8");
  check(
    "the update target is the tracked branch's remote ref, never the checkout's HEAD",
    shell.includes("`origin/${cfg.branch}`") && !shell.includes('"pull", "--ff-only"')
  );
  check(
    "the auto poll compares against what is being SERVED, not against HEAD",
    /liveBuild\(\)\?\.sha !== target\.sha/.test(shell)
  );
}
check("the config template is tracked", existsSync("supervisor/config.example.json"));
check(
  "the real config (device token) is gitignored",
  readFileSync(".gitignore", "utf8").includes("supervisor/config.json")
);
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
};
check("local:supervisor is wired", !!pkg.scripts["local:supervisor"]);
check("local:restore is wired", !!pkg.scripts["local:restore"]);
check(
  "embedded-postgres is a RUNTIME dependency (the local peer needs it at runtime)",
  !!pkg.dependencies["embedded-postgres"] && !pkg.devDependencies?.["embedded-postgres"]
);

const localAuth = readFileSync("src/lib/auth/local.ts", "utf8");
check(
  "local.ts never imports Clerk (the seam holds)",
  !/from\s+["']@clerk\/nextjs/.test(localAuth)
);

const restoreSrc = readFileSync("scripts/local-restore.mjs", "utf8");
check(
  "the restore script clears the cloned sync identity (ops, device, peers, cursors)",
  restoreSrc.includes("truncate sync_ops") &&
    restoreSrc.includes("delete from sync_device") &&
    restoreSrc.includes("truncate sync_peers") &&
    restoreSrc.includes("sync:cursor:")
);
// Regression, 2026-08-23: job_state is INSIDE the fill's copy set, so every
// per-instance key in it must be cleared after a fill or the peer inherits the
// source's. `sync:mode` (the GUI push-mode override) shipped the same day the
// clearing list forgot it, which would have silently armed or disarmed push on
// a re-filled peer. Both fill paths — dump and live pull — have to clear it.
{
  // Count the DELETE statements, not mentions: a comment saying it happens
  // must not satisfy this.
  const clears = restoreSrc
    .split("\n")
    .filter((l) => l.includes("delete from job_state") && l.includes("sync:mode")).length;
  check(
    "BOTH fill paths clear the push-mode override in an actual DELETE",
    clears >= 2,
    `${clears} statement(s)`
  );
}
check(
  "the restore script re-seeds a fresh device identity",
  /insert into sync_device/.test(restoreSrc)
);
check(
  "local-restore.mjs never reads the DB env var directly (writes only ever target 127.0.0.1; the --from-url source connection is the one deliberate, read-only exception)",
  !restoreSrc.includes(`process.env.${DB_KEY}`) && restoreSrc.includes("127.0.0.1")
);
check(
  "the --from-url path is native (no pg_dump/pg_restore shelled out to; copies rows with the pg driver)",
  !restoreSrc.includes('"pg_dump"') && restoreSrc.includes("copyAllTables")
);
check(
  "the --from-url connection string is redacted rather than logged raw",
  restoreSrc.includes("redactConnectionString") && !/console\.(log|error)\(`[^`]*\$\{fromUrl\}/.test(restoreSrc)
);

const supervisorSrc = readFileSync("supervisor/ledgr-supervisor.mjs", "utf8");
check(
  "the supervisor watches the same signal file the updates route writes",
  supervisorSrc.includes("signalPath") &&
    readFileSync("src/app/api/updates/route.ts", "utf8").includes("update-requested") &&
    readFileSync("supervisor/lib.mjs", "utf8").includes('"update-requested"')
);
check(
  "the flip is guarded by decideFlip (keep-last-good is the rule, not a comment)",
  supervisorSrc.includes("decideFlip")
);

// ── Single-instance ownership (regression, 2026-08-23) ──────────────────────
//
// Three supervisors had accumulated on one machine, because stopping
// `npm run local:supervisor` kills npm and orphans its node child. An orphan
// won the race for an update signal file, tried to apply it with its app and
// Postgres already killed underneath it, and the update failed silently. Two
// is also the state README steps 5 and 7 produce on purpose (run it in a
// terminal, then register it at boot), so the lock is the fix, not a warning.
{
  check("the lock lives in the data dir, beside the other supervisor state", lockPath("/data").endsWith("supervisor.lock"));
  check("no owner recorded (garbage or empty file) -> take it", lockVerdict(NaN, 42, false) === "take");
  check("a zero/negative pid is garbage, not an owner", lockVerdict(0, 42, false) === "take");
  check("the recorded owner is alive -> REFUSE, this is the whole point", lockVerdict(99, 42, true) === "refuse");
  check("the recorded owner is gone -> steal the stale lock", lockVerdict(99, 42, false) === "steal");
  check("our own pid -> already mine, never refuse ourselves", lockVerdict(42, 42, true) === "mine");
}
check(
  "the supervisor takes the lock BEFORE starting postgres (a loser must touch nothing)",
  supervisorSrc.indexOf("acquireLock()") > 0 &&
    supervisorSrc.indexOf("acquireLock()") < supervisorSrc.indexOf("await startPostgres()")
);
check(
  "the lock file is created atomically (wx), so a simultaneous start cannot double-take",
  supervisorSrc.includes("writeFileSync(lock") && supervisorSrc.includes('flag: "wx"')
);
check(
  "EPERM counts as alive (the owner exists, it just is not ours); only ESRCH is gone",
  supervisorSrc.includes('err?.code === "EPERM"')
);
check("the lock is released on shutdown", supervisorSrc.includes("releaseLock()"));


// ── (N) The startup signal file — the in-app toggle's channel (ADR-211) ──────
//
// Same signal-file pattern as update-requested, deliberately. A malformed or
// truncated file must read as "no request" — acting on a half-written file is
// how a toggle turns into a surprise.
check(
  "a request round-trips",
  JSON.stringify(parseStartupRequest(serializeStartupRequest(true, "always"))) ===
    JSON.stringify({ enabled: true, scope: "always" })
);
check(
  "a disable request round-trips",
  parseStartupRequest(serializeStartupRequest(false, "logon"))?.enabled === false
);
check("a truncated request is ignored", parseStartupRequest('{"enabled":tr') === null);
check("an empty file is ignored", parseStartupRequest("") === null);
check("a request without enabled is ignored", parseStartupRequest('{"scope":"always"}') === null);
check(
  "a request with a junk scope still parses, defaulting to logon",
  parseStartupRequest('{"enabled":true,"scope":"whenever"}')?.scope === "logon"
);

// The recorded outcome. ok:false is a NORMAL state (elevation refused), so it
// has to survive the round trip with its detail and its escape-hatch command —
// an owner who ticks a box and is not told it failed believes their hub comes
// back after a reboot.
{
  const failed = parseStartupState(
    serializeStartupState({
      enabled: true,
      scope: "always",
      ok: false,
      detail: "Access is denied.",
      command: "schtasks /Create ...",
    })
  );
  check(
    "a failed registration round-trips with its reason and command",
    failed?.ok === false && failed.detail === "Access is denied." && !!failed.command
  );
  const good = parseStartupState(
    serializeStartupState({ enabled: true, scope: "logon", ok: true })
  );
  check("a successful registration round-trips", good?.ok === true && good.scope === "logon");
  check(
    "state defaults to NOT ok when the flag is missing, never to success",
    parseStartupState('{"enabled":true,"scope":"logon"}')?.ok === false
  );
  check("unreadable state is null", parseStartupState("nonsense") === null);
}

check(
  "the startup signal and state files live in the data dir, beside update-requested",
  startupSignalPath("/data/ledgr").endsWith("startup-requested") &&
    startupStatePath("/data/ledgr").endsWith("startup-state.json")
);
check("the stop request lives there too", stopSignalPath("/data/ledgr").endsWith("stop-requested"));

// ── Stopping has to be GRACEFUL, and on Windows a signal cannot be (ADR-211) ─
//
// `process.kill(pid, "SIGTERM")` from another process does not deliver a
// catchable signal on Windows: it terminates outright, so the shutdown handler
// never runs — Postgres is killed rather than shut down (recovery on the next
// start) and the lock file survives looking like a live owner. Observed live on
// the dev rig. The stop path therefore has to ASK through the file the
// supervisor polls, and reach the same handler a Ctrl-C reaches.
check(
  "the supervisor polls the stop request and routes it through shutdown()",
  supervisorSrc.includes("stopSignalPath") && /shutdown\("stop-requested"\)/.test(supervisorSrc)
);
{
  const ctlSrc = readFileSync("supervisor/ledgr-ctl.mjs", "utf8");
  check(
    "stop asks through the file rather than signalling the pid",
    ctlSrc.includes("stopSignalPath") && !/process\.kill\([^)]*"SIGTERM"/.test(ctlSrc)
  );
  check(
    "stop still verifies the process actually went away, rather than assuming",
    ctlSrc.includes("pidAlive(pid)")
  );
  check(
    "status and stop never hard-kill (no SIGKILL anywhere in the control script)",
    !ctlSrc.includes("SIGKILL")
  );
}

// The cluster has to be SHUT DOWN, not killed. embedded-postgres stops it with
// `taskkill /f /t` on Windows, so every stop left the next start replaying WAL
// ("database system was not properly shut down") — seen on the dev rig. Asking
// pg_ctl for a fast shutdown first is what makes "stops cleanly" true.
check(
  "shutdown asks pg_ctl for a real shutdown before falling back to the library kill",
  /pg_ctl/.test(supervisorSrc) &&
    supervisorSrc.includes('"-m", "fast"') &&
    supervisorSrc.includes("stopPostgresGracefully")
);
check(
  "the forced fallback is still there, and bounded so a wedged cluster cannot hang shutdown",
  supervisorSrc.includes("Promise.race([pg.stop()")
);


// ── (10) Local crons: the scheduler seam on a self-hosted peer (ADR-214) ─────
//
// A local peer has no external scheduler at all, so these decisions are what
// stand between "the oplog prunes" and "it silently never does".

// The load-bearing default. Only jobs that are SAFE on more than one peer at
// once may default on, because a local peer runs alongside the cloud
// deployment, which is still running all of them. Flipping export or
// calendar-sync to `on: true` would have two peers writing one OneDrive folder
// and two peers creating items from the same calendar events.
{
  const defaults = normalizeCrons(undefined).map((j) => j.name).sort();
  check(
    // `snapshot` joined this list in ADR-222: the job is scheduled everywhere
    // and the ENDPOINT decides whether to dump, which is what lets the owner's
    // on/off be a checkbox instead of a config edit plus a service restart.
    "purge, relatedness and the hourly snapshot check run by default",
    JSON.stringify(defaults) === JSON.stringify(["purge", "relatedness", "snapshot"]),
    defaults.join(",")
  );
  check(
    "every default-on job is one that is safe on more than one peer at once",
    Object.values(LOCAL_JOBS).every((j) => !j.on || j.shared === true)
  );
  check(
    "every job that writes somewhere shared is off by default",
    Object.values(LOCAL_JOBS).every((j) => j.shared || !j.on)
  );
  check(
    "purge is in the catalog and defaults on — it is the one that prunes the oplog",
    LOCAL_JOBS.purge?.on === true && LOCAL_JOBS.purge?.path === "/api/machine/purge"
  );
  check(
    "every catalog entry says why its sharing verdict is what it is",
    Object.values(LOCAL_JOBS).every((j) => typeof j.why === "string" && j.why.length > 20)
  );
}

// A mistyped job name must throw. Silently scheduling nothing is exactly the
// failure this slice exists to remove.
check("an unknown job name is refused", throws(() => normalizeCrons({ purgee: true })));
check(
  "a non-object crons block is refused",
  throws(() => normalizeCrons(["purge"])) && throws(() => normalizeCrons(7))
);
check("crons: false turns everything off", normalizeCrons(false).length === 0);
check(
  "a job can be turned off individually",
  normalizeCrons({ purge: false, snapshot: false }).map((j) => j.name).join(",") === "relatedness"
);
check(
  "an exclusive job runs only when asked for explicitly",
  normalizeCrons({ export: true }).some((j) => j.name === "export") &&
    !normalizeCrons({}).some((j) => j.name === "export")
);
check(
  "an override is validated, not trusted",
  throws(() => normalizeCrons({ purge: { at: "25:00" } })) &&
    throws(() => normalizeCrons({ purge: { at: "9:5" } })) &&
    throws(() => normalizeCrons({ "todoist-sync": { everyMinutes: 0 } })) &&
    throws(() => normalizeCrons({ purge: "03:00" }))
);
check(
  "an override actually takes effect",
  normalizeCrons({ purge: { at: "05:45" } })[0].at === "05:45" &&
    normalizeCrons({ purge: { everyMinutes: 90 } })[0].intervalMs === 90 * 60_000
);

// A strict HH:MM parse, because "9:5" quietly becoming midnight would move a
// job hours from where the owner put it.
check(
  "parseDailyAt is strict",
  parseDailyAt("03:10")?.h === 3 &&
    parseDailyAt("23:59")?.m === 59 &&
    parseDailyAt("9:5") === null &&
    parseDailyAt("24:00") === null &&
    parseDailyAt("") === null &&
    parseDailyAt(undefined) === null
);

// Strictly after `from`: an "at or after" comparison returns the same instant
// the job just ran at, so a daily job fires on every single tick.
{
  const noon = new Date(2026, 7, 23, 12, 0, 0, 0).getTime();
  const at1210 = nextDailyAt("12:10", noon);
  const at1150 = nextDailyAt("11:50", noon);
  const atNoon = nextDailyAt("12:00", noon);
  check("the next daily slot later today is today", at1210 - noon === 10 * 60_000);
  check("a slot already past today is tomorrow", at1150 - noon === (24 * 60 - 10) * 60_000);
  check(
    "the slot happening exactly now is TOMORROW, not now",
    atNoon - noon === 24 * 60 * 60_000
  );
}

// A failure costs a short retry, not a whole day — and cannot make a job run
// more often than its own schedule allows.
{
  const [purge] = normalizeCrons({ purge: true, relatedness: false });
  const [fast] = normalizeCrons({
    purge: false,
    relatedness: false,
    snapshot: false,
    "transcription-poll": { everyMinutes: 5 },
  });
  const now = new Date(2026, 7, 23, 12, 0, 0, 0).getTime();
  check(
    "a failed daily job retries in minutes, not tomorrow",
    nextRunAt(purge, now, false) - now === CRON_RETRY_MS
  );
  check(
    "a failure can never make a job run MORE often than its own schedule",
    nextRunAt(fast, now, false) - now === 5 * 60_000
  );
  check(
    "a successful daily job waits for its next slot",
    nextRunAt(purge, now, true) === nextDailyAt("03:10", now)
  );
}

// A laptop asleep every night at 03:10 would never purge, which IS the "the
// oplog never prunes" bug wearing a different hat. Anything overdue by more
// than its own period runs shortly after boot instead.
{
  const [purge] = normalizeCrons({ purge: true, relatedness: false });
  const now = Date.now();
  const twoDaysAgo = new Date(now - 2 * 24 * 3600_000).toISOString();
  const anHourAgo = new Date(now - 3600_000).toISOString();
  check(
    "a job overdue by more than its period runs shortly after boot",
    initialDueAt(purge, twoDaysAgo, now) - now === CRON_STARTUP_GRACE_MS
  );
  check(
    "a job that has never run at all runs shortly after boot",
    initialDueAt(purge, null, now) - now === CRON_STARTUP_GRACE_MS
  );
  check(
    "a job that ran recently waits for its normal slot",
    initialDueAt(purge, anHourAgo, now) === nextDailyAt("03:10", now)
  );
}

// The surfaces have to be able to tell "fine", "the last one failed" and "this
// stopped firing a while ago" apart — the third is what a dead scheduler looks
// like from the outside.
{
  const [purge] = normalizeCrons({ purge: true, relatedness: false });
  const now = Date.now();
  const iso = (ms: number) => new Date(now - ms).toISOString();
  check("no record reads as never", jobStaleness(undefined, purge, now) === "never");
  check(
    "a failed last attempt reads as failing",
    jobStaleness({ lastRunAt: iso(60_000), lastOkAt: iso(3600_000), ok: false }, purge, now) ===
      "failing"
  );
  check(
    "a fresh success reads as ok",
    jobStaleness({ lastRunAt: iso(60_000), lastOkAt: iso(60_000), ok: true }, purge, now) === "ok"
  );
  check(
    "a success older than several periods reads as late",
    jobStaleness(
      { lastRunAt: iso(60_000), lastOkAt: iso(5 * 24 * 3600_000), ok: true },
      purge,
      now
    ) === "late"
  );
}

// The state file is the whole surfacing mechanism (Build → Updates, /health,
// local:status), so it has to survive being half-written or absent.
{
  // Two jobs, so the round-trip count below stays about serialization rather
  // than about how many jobs happen to default on.
  const jobs = normalizeCrons({ snapshot: false });
  const now = Date.now();
  const text = serializeCronState(
    jobs,
    {
      purge: {
        dueAt: now + 60_000,
        lastRunAt: new Date(now).toISOString(),
        lastOkAt: new Date(now).toISOString(),
        ok: true,
        detail: null,
        runs: 3,
        fails: 1,
      },
    },
    now
  );
  // lib.mjs is untyped, so name the row shape the surfaces actually consume.
  type Row = { name: string; shared: boolean; runs: number; fails: number; state: string };
  const byName = (text: string, name: string): Row | undefined =>
    (parseCronState(text)?.jobs as Row[] | undefined)?.find((j) => j.name === name);

  check("the recorded state round-trips", parseCronState(text)?.jobs.length === 2);
  check(
    "a recorded run keeps its counts and its verdict",
    byName(text, "purge")?.runs === 3 &&
      byName(text, "purge")?.fails === 1 &&
      byName(text, "purge")?.state === "ok"
  );
  check(
    "a job with nothing recorded is 'never', not silently ok",
    byName(text, "relatedness")?.state === "never"
  );
  check(
    "the exclusive flag survives to the surfaces, so they can warn about it",
    byName(serializeCronState(normalizeCrons({ export: true }), {}, now), "export")?.shared ===
      false
  );
  check(
    "a truncated or garbage record reads as no record, never a throw",
    parseCronState(text.slice(0, 40)) === null &&
      parseCronState("") === null &&
      parseCronState("{}") === null
  );
  check("the credential never appears in the record", !text.includes("Bearer"));
}

// The supervisor's own token is APPENDED to the app's token list. Assigning it
// instead would wipe the owner's configured tokens — taking the MCP server and
// every webhook down in order to run a purge.
{
  const cfg = normalizeConfig(
    { ...goodRaw, extraEnv: { LEDGR_API_TOKENS: "mcp-main:mcp:aaa" } },
    "/base"
  );
  const withCron = assembleAppEnv(cfg, "sha", {
    cronTokenHash: "deadbeef",
    inheritedApiTokens: "inherited:cron:bbb",
  });
  const parts = (withCron.LEDGR_API_TOKENS ?? "").split(",");
  check(
    "the supervisor's cron entry is added alongside the owner's tokens",
    parts.includes("mcp-main:mcp:aaa") &&
      parts.includes("inherited:cron:bbb") &&
      parts.includes(localCronTokenEntry("deadbeef"))
  );
  check(
    "the minted entry carries the cron scope and nothing more",
    localCronTokenEntry("deadbeef") === "local-cron:cron:deadbeef"
  );
  check(
    "with no jobs scheduled, nothing is injected and extraEnv is untouched",
    assembleAppEnv(cfg, "sha", {}).LEDGR_API_TOKENS === "mcp-main:mcp:aaa"
  );
}

// The shell side. These are source checks because the runner is the spawn/fetch
// half, but each names a real way to get this wrong.
{
  check(
    "the runner walks through the ordinary machine-token door, not a bypass",
    /Authorization: `Bearer \$\{CRON_TOKEN\}`/.test(supervisorSrc)
  );
  check(
    "it calls loopback, never a configured hub or a public address",
    supervisorSrc.includes("http://127.0.0.1:${cfg.appPort}${job.path}")
  );
  // The raw credential lives in memory and reaches exactly two places: the two
  // Authorization headers. Anywhere else — a log line, the state file — is a
  // leak, so the allowed lines are enumerated rather than pattern-excluded.
  {
    const bare = supervisorSrc
      .split("\n")
      .filter((l) => /\bCRON_TOKEN\b/.test(l.replace(/CRON_TOKEN_HASH/g, "")));
    check(
      "the raw token only ever appears where it is minted or sent as a Bearer header",
      bare.length > 0 &&
        bare.every((l) => /randomBytes|createHash|cfg\.crons\.length|Bearer \$\{CRON_TOKEN\}/.test(l)),
      bare.find((l) => !/randomBytes|createHash|cfg\.crons\.length|Bearer \$\{CRON_TOKEN\}/.test(l))?.trim()
    );
    check(
      "only the hash reaches the app child's environment",
      supervisorSrc.includes("cronTokenHash: CRON_TOKEN_HASH")
    );
  }
  check(
    "a failed run is reported into error_log the same way the CI workflows do",
    supervisorSrc.includes("/api/machine/report-error") &&
      /if \(!ok\) await reportCronFailure\(/.test(supervisorSrc)
  );
  check(
    "no job fires while an update is in flight (the app is down mid-flip)",
    /if \(cronBusy \|\| updating\) return;/.test(supervisorSrc)
  );
  check(
    "the state file is written at startup, so 'no jobs' and 'no supervisor' differ",
    supervisorSrc.includes("primeCronState()")
  );
  check(
    "every run is recorded, pass or fail",
    /writeCronState\(\);/.test(supervisorSrc) && supervisorSrc.includes('log(ok ? "cron job ok"')
  );
  const ctlSrc2 = readFileSync("supervisor/ledgr-ctl.mjs", "utf8");
  check(
    "status reports the jobs too, so an install agent can verify rather than assume",
    ctlSrc2.includes("recordedCronState") && ctlSrc2.includes("crons:")
  );
}


// ── (11) The performance pass (ADR-215) ──────────────────────────────────────
//
// Local Postgres tuning: RAM-sized flags, an off switch, and manual overrides
// that always win. The stock embedded-postgres defaults (128MB shared_buffers,
// random_page_cost 4) could not hold a real Ledgr database and overpriced the
// index scans every list depends on.
{
  const { tunedPostgresFlags } = await import("../supervisor/lib.mjs");
  const GB = 1024 * 1024 * 1024;
  const base = normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c" }, "/x");
  const flags32 = tunedPostgresFlags(base, 32 * GB);
  const text32 = flags32.join(" ");
  check(
    "32GB machine: shared_buffers clamps at 1GB (RAM/8 would be 4GB)",
    text32.includes("shared_buffers=1024MB"),
    text32
  );
  check("SSD random_page_cost is set", text32.includes("random_page_cost=1.1"));
  check("work_mem raised from the 4MB stock", text32.includes("work_mem=16MB"));
  const flags8 = tunedPostgresFlags(base, 8 * GB).join(" ");
  check("8GB machine: shared_buffers = RAM/8 = 1024MB", flags8.includes("shared_buffers=1024MB"));
  const flags1 = tunedPostgresFlags(base, 1 * GB).join(" ");
  check(
    "tiny machine: shared_buffers never sizes below the 128MB stock",
    flags1.includes("shared_buffers=128MB"),
    flags1
  );
  check(
    "garbage RAM input still yields safe floors, never NaN flags",
    !tunedPostgresFlags(base, NaN).join(" ").includes("NaN")
  );
  const off = normalizeConfig(
    { dataDir: "/d", ownerEmail: "a@b.c", tunePostgres: false, postgresFlags: ["-c", "work_mem=64MB"] },
    "/x"
  );
  check(
    "tunePostgres:false passes ONLY the owner's own flags (stock otherwise)",
    JSON.stringify(tunedPostgresFlags(off, 32 * GB)) === JSON.stringify(["-c", "work_mem=64MB"])
  );
  const both = normalizeConfig(
    { dataDir: "/d", ownerEmail: "a@b.c", postgresFlags: ["-c", "shared_buffers=64MB"] },
    "/x"
  );
  const merged = tunedPostgresFlags(both, 32 * GB);
  check(
    "a manual flag comes AFTER its tuned counterpart, so it wins (postgres takes the last -c)",
    merged.lastIndexOf("shared_buffers=64MB") > merged.indexOf("shared_buffers=1024MB")
  );
  check(
    "non-string junk in postgresFlags is dropped, not passed to the server",
    normalizeConfig(
      { dataDir: "/d", ownerEmail: "a@b.c", postgresFlags: ["-c", 5, null, "x=1"] },
      "/x"
    ).postgresFlags.join(",") === "-c,x=1"
  );
}

// A restore that hands over a database with no statistics is the A2 bug: the
// planner believed items held 7 rows against 23,470 real, and the related
// panel alone cost 11× the buffers it should have. Both fill paths must end
// with VACUUM ANALYZE.
{
  const restoreSrc = readFileSync("scripts/local-restore.mjs", "utf8");
  check(
    "local-restore actually RUNS vacuum analyze (the query call, not just a log line)",
    restoreSrc.includes('db.query("vacuum analyze")') && restoreSrc.includes("analyzeAfterFill")
  );
  check(
    "BOTH fill paths analyze (the dump restore and --from-url)",
    (restoreSrc.match(/await analyzeAfterFill\(/g) ?? []).length >= 2
  );
  check(
    "the restore cluster starts with the same tuned flags the supervisor uses",
    restoreSrc.includes("tunedPostgresFlags")
  );
}

// The supervisor's cluster gets the tuned flags too.
check(
  "the supervisor passes tuned postgresFlags to embedded-postgres",
  supervisorSrc.includes("postgresFlags: tunedPostgresFlags(cfg, totalmem())")
);

// The two query rewrites are structural, so guard the structure: each one
// regressed means an O(all items) plan comes back on every item-page open /
// Most-linked render (26,653 and 122,194 buffers respectively, measured).
{
  const relationsSrc = readFileSync("src/lib/relations.ts", "utf8");
  check(
    "relatedItemsQuery reads the edges first (UNION ALL), not an OR-join over items",
    relationsSrc.includes("unionAll(") &&
      !/innerJoin\(\s*items,\s*or\(/.test(relationsSrc)
  );
  const viewsSrc = readFileSync("src/lib/views.ts", "utf8");
  check(
    "mostLinked aggregates relations once — the correlated per-row count(*) is gone",
    viewsSrc.includes('sort.field === "mostLinked"') &&
      viewsSrc.includes("unionAll(") &&
      !/select count\(\*\) from relations r where/.test(viewsSrc)
  );
}

// Request-level dedupe on the two reads every page repeats (Nav + page each
// re-queried settings and types per navigation: two extra HTTP round trips
// per click on the neon-http driver).
{
  const settingsSrc = readFileSync("src/lib/settings.ts", "utf8");
  check(
    "getSettings is wrapped in React cache()",
    /export const getSettings = cache\(/.test(settingsSrc)
  );
  const typesSrc = readFileSync("src/lib/types.ts", "utf8");
  check(
    "listTypes dedupes through a cache() keyed on a PRIMITIVE (an object arg never hits)",
    /cache\(async \(includeHidden: boolean\)/.test(typesSrc) &&
      typesSrc.includes("listTypesCached(opts.includeHidden === true)")
  );
}

// The measurement itself stays runnable and read-only: the audit script must
// refuse anything that is not a SELECT, so it stays safe to point at the live
// spoke or the cloud pooler.
{
  const auditSrc = readFileSync("scripts/perf-audit.mts", "utf8");
  check(
    "perf-audit guards every statement through assertSelectOnly",
    auditSrc.includes("assertSelectOnly(q.sql)") &&
      auditSrc.includes('startsWith("select")')
  );
  check(
    "perf-audit measures buffers, not just wall clock",
    auditSrc.includes("ANALYZE, BUFFERS")
  );
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
