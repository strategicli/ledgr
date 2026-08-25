// Pure decision logic for the local-peer supervisor (plan phase 2 / LH2,
// ADR-206 decision 6). Everything here is side-effect free and imported by
// scripts/verify-supervisor.mts; the process/spawn shell lives in
// ledgr-supervisor.mjs and stays thin. Node builtins only.
import { join, resolve, isAbsolute } from "node:path";

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * Validate + normalize supervisor/config.json. `baseDir` anchors relative
 * paths (the directory the config file lives in). Throws with a readable
 * message on anything unusable; fills documented defaults for the rest.
 */
export function normalizeConfig(raw, baseDir) {
  if (!raw || typeof raw !== "object") throw new Error("config must be a JSON object");
  const cfg = raw;

  if (typeof cfg.dataDir !== "string" || cfg.dataDir.length === 0) {
    throw new Error("config.dataDir is required (where Postgres data and builds live)");
  }
  if (typeof cfg.ownerEmail !== "string" || !cfg.ownerEmail.includes("@")) {
    throw new Error("config.ownerEmail is required (the local owner identity, LEDGR_LOCAL_OWNER_EMAIL)");
  }
  const role = cfg.role ?? "spoke";
  if (role !== "hub" && role !== "spoke") {
    throw new Error(`config.role must be "hub" or "spoke", got ${JSON.stringify(role)}`);
  }
  const updateMode = cfg.update?.mode ?? "prompted";
  if (updateMode !== "prompted" && updateMode !== "auto") {
    throw new Error(`config.update.mode must be "prompted" or "auto", got ${JSON.stringify(updateMode)}`);
  }
  const syncMode = cfg.syncMode ?? "full";
  if (syncMode !== "full" && syncMode !== "pull-only") {
    throw new Error(`config.syncMode must be "full" or "pull-only", got ${JSON.stringify(syncMode)}`);
  }
  const hubs = Array.isArray(cfg.hubs) ? cfg.hubs.filter((h) => typeof h === "string" && h.length > 0) : [];

  const abs = (p, fallback) => {
    const v = typeof p === "string" && p.length > 0 ? p : fallback;
    return isAbsolute(v) ? v : resolve(baseDir, v);
  };
  const port = (v, fallback) => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`invalid port: ${JSON.stringify(v)}`);
    return n;
  };

  return {
    role,
    dataDir: abs(cfg.dataDir),
    // The git clone the supervisor pulls and builds from. Default: the repo
    // the supervisor script itself lives in (config sits in <repo>/supervisor).
    repoDir: abs(cfg.repoDir, ".."),
    branch: typeof cfg.branch === "string" && cfg.branch ? cfg.branch : "main",
    appPort: port(cfg.appPort, 3000),
    dbPort: port(cfg.dbPort, 5433),
    ownerEmail: cfg.ownerEmail,
    hubs,
    deviceToken: typeof cfg.deviceToken === "string" ? cfg.deviceToken : "",
    syncMode,
    update: {
      mode: updateMode,
      pollIntervalMs: Math.max(60_000, Number(cfg.update?.pollIntervalMs) || 15 * 60_000),
    },
    cadence: {
      pushDebounceMs: Number(cfg.cadence?.pushDebounceMs) || 2000,
      pullMs: Number(cfg.cadence?.pullMs) || 10_000,
    },
    // Guardrails 2 & 3 (first-push size guard, clock-skew hold). Defaults
    // mirror src/lib/sync/client.ts's own fallbacks, so an unset config and an
    // unset env var behave identically.
    syncGuardrails: {
      maxFirstPush: Math.max(1, Number(cfg.syncGuardrails?.maxFirstPush) || 500),
      confirmLargePush: cfg.syncGuardrails?.confirmLargePush === true,
      skewWarnMs: Math.max(0, Number(cfg.syncGuardrails?.skewWarnMs) || 5000),
      skewHoldMs: Math.max(0, Number(cfg.syncGuardrails?.skewHoldMs) || 60_000),
    },
    // Which scheduled jobs this peer triggers for itself (ADR-214). Resolved
    // against LOCAL_JOBS below, so a mistyped job name throws here rather than
    // silently running nothing.
    crons: normalizeCrons(cfg.crons),
    // Local Postgres tuning (ADR-215). `tunePostgres: false` turns the
    // auto-sizing off; `postgresFlags` appends raw flags AFTER the tuned set,
    // and for a repeated -c the last occurrence wins, so a manual flag always
    // overrides the automatic one.
    tunePostgres: cfg.tunePostgres !== false,
    postgresFlags: Array.isArray(cfg.postgresFlags)
      ? cfg.postgresFlags.filter((f) => typeof f === "string" && f.length > 0)
      : [],
    // Extra env passed through to the app verbatim (R2 keys, Graph secrets…).
    extraEnv: cfg.extraEnv && typeof cfg.extraEnv === "object" ? { ...cfg.extraEnv } : {},
  };
}

// ── Local Postgres tuning (ADR-215) ──────────────────────────────────────────
//
// embedded-postgres ships stock defaults sized for a machine from 2005:
// shared_buffers 128MB (the prod spoke's whole 798MB database cannot stay
// cached, so any page-heavy query evicts itself every run — the A2 finding),
// random_page_cost 4 (the spinning-disk number; it made the planner overprice
// the index scans every list depends on), work_mem 4MB. The supervisor knows
// the machine's RAM, so size these automatically rather than leaving a number
// in a config file nobody revisits.
//
// Every value here is a session-safe, restart-applied server GUC; none of them
// change what is on disk, so a peer can flip tunePostgres off and restart back
// to stock at any time.

/** Format bytes as a Postgres memory setting (whole MB). */
function asMB(bytes) {
  return `${Math.max(1, Math.floor(bytes / (1024 * 1024)))}MB`;
}

/**
 * The tuned flag set for a machine with `totalMemBytes` of RAM. Pure so the
 * verify suite can sweep sizes. Returns [] when tuning is off.
 *
 *   shared_buffers        RAM/8, clamped [128MB, 1GB] — enough that a real
 *                         Ledgr database (798MB measured) fits entirely, small
 *                         enough to be invisible on an 8GB laptop.
 *   effective_cache_size  RAM/2 — planner-only (allocates nothing); tells it
 *                         the OS cache exists, which stock 4GB already said,
 *                         but keep it honest on small machines.
 *   random_page_cost      1.1 — the SSD number. A peer genuinely on spinning
 *                         rust overrides via postgresFlags.
 *   work_mem              16MB — sorts of 200-row list pages never spill.
 *   maintenance_work_mem  RAM/32 clamped [64MB, 256MB] — VACUUM and
 *                         CREATE INDEX during restores/migrations.
 */
export function tunedPostgresFlags(cfg, totalMemBytes) {
  if (!cfg.tunePostgres) return [...cfg.postgresFlags];
  const mem = Number(totalMemBytes) || 0;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const MB = 1024 * 1024;
  const flags = [
    "-c", `shared_buffers=${asMB(clamp(mem / 8, 128 * MB, 1024 * MB))}`,
    "-c", `effective_cache_size=${asMB(Math.max(mem / 2, 512 * MB))}`,
    "-c", "random_page_cost=1.1",
    "-c", "work_mem=16MB",
    "-c", `maintenance_work_mem=${asMB(clamp(mem / 32, 64 * MB, 256 * MB))}`,
  ];
  // Owner overrides append last: for a repeated -c, postgres takes the last
  // occurrence, so a manual flag beats its tuned counterpart.
  return [...flags, ...cfg.postgresFlags];
}

// ── Env assembly ─────────────────────────────────────────────────────────────

export function buildDbUrl(cfg) {
  return `postgresql://postgres:postgres@127.0.0.1:${cfg.dbPort}/ledgr`;
}

/**
 * The env the app child is spawned with (merged over process.env by the
 * shell). LEDGR_SELF_UPDATE is "on" because the supervisor's apply path runs
 * migrate before the flip, which is exactly the condition "on" encodes
 * (mirror of build:satellite's migrate-then-build ordering).
 *
 * `opts.cronTokenHash` adds the supervisor's own ephemeral cron token to the
 * app's token list (ADR-214) so its scheduled calls come in through the
 * ordinary machine-token door. It is APPENDED to whatever tokens the owner
 * already configured — in `extraEnv` or in the real environment, passed as
 * `opts.inheritedApiTokens` — because clobbering the owner's tokens to make
 * room for ours would take the MCP server down to run a purge.
 */
export function assembleAppEnv(cfg, buildSha, opts = {}) {
  const env = {
    NODE_ENV: "production",
    DATABASE_URL: buildDbUrl(cfg),
    PORT: String(cfg.appPort),
    LEDGR_BUILD_SHA: buildSha ?? "",
    LEDGR_LOCAL_OWNER_EMAIL: cfg.ownerEmail,
    LEDGR_SUPERVISOR_DIR: cfg.dataDir,
    LEDGR_SELF_UPDATE: "on",
    LEDGR_SYNC_PUSH_DEBOUNCE_MS: String(cfg.cadence.pushDebounceMs),
    LEDGR_SYNC_PULL_MS: String(cfg.cadence.pullMs),
    ...cfg.extraEnv,
  };
  // Sync arms only when both halves exist (mirrors startSyncLoop's own gate);
  // a hub, or a spoke not yet joined, gets neither var rather than half.
  if (cfg.hubs.length > 0 && cfg.deviceToken) {
    env.LEDGR_SYNC_HUBS = cfg.hubs.join(",");
    env.LEDGR_SYNC_TOKEN = cfg.deviceToken;
    env.LEDGR_SYNC_MODE = cfg.syncMode;
    env.LEDGR_SYNC_MAX_FIRST_PUSH = String(cfg.syncGuardrails.maxFirstPush);
    env.LEDGR_SYNC_CONFIRM_LARGE_PUSH = String(cfg.syncGuardrails.confirmLargePush);
    env.LEDGR_SYNC_SKEW_WARN_MS = String(cfg.syncGuardrails.skewWarnMs);
    env.LEDGR_SYNC_SKEW_HOLD_MS = String(cfg.syncGuardrails.skewHoldMs);
  }
  // After the extraEnv spread on purpose: the merged list has to win over an
  // extraEnv entry, or the owner's own LEDGR_API_TOKENS would drop ours.
  if (opts.cronTokenHash) {
    env.LEDGR_API_TOKENS = [
      opts.inheritedApiTokens,
      cfg.extraEnv.LEDGR_API_TOKENS,
      localCronTokenEntry(opts.cronTokenHash),
    ]
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(",");
  }
  return env;
}

// ── The live pointer (keep-last-good) ────────────────────────────────────────
//
// Which build directory `next start` runs from is a tiny JSON pointer file,
// <dataDir>/live.json — deliberately not a symlink/junction: a plain file the
// supervisor reads at spawn works identically on win32/darwin/linux, needs no
// privileges, and survives tools that don't follow reparse points.

export function livePointerPath(dataDir) {
  return join(dataDir, "live.json");
}

export function buildsDir(dataDir) {
  return join(dataDir, "builds");
}

export function signalPath(dataDir) {
  return join(dataDir, "update-requested");
}

// ── "Start when Windows starts" (ADR-211) ────────────────────────────────────
//
// Same shape as the update signal above, deliberately: the app cannot register
// a scheduled task itself (the always-on scope wants an elevated prompt), so
// it writes a signal file and the supervisor — already a long-running local
// process the owner started — does the work and records what happened where
// the app can read it. One signal-file pattern, not two.

/**
 * The graceful-stop request. Needed because on Windows `process.kill(pid,
 * "SIGTERM")` does NOT deliver a signal a Node handler can catch — it
 * terminates the process outright, so the supervisor's shutdown path never
 * runs: Postgres is killed rather than shut down (recovery on the next start)
 * and the lock file is left behind looking like a live owner. Asking through a
 * file lets the process stop ITSELF through the same handler a Ctrl-C uses.
 */
export function stopSignalPath(dataDir) {
  return join(dataDir, "stop-requested");
}

export function startupSignalPath(dataDir) {
  return join(dataDir, "startup-requested");
}

export function startupStatePath(dataDir) {
  return join(dataDir, "startup-state.json");
}

export const STARTUP_TASK_NAME = "Ledgr Supervisor";

/**
 * The two scopes, and the difference matters enough that nothing defaults it
 * silently:
 *   "logon"  — /SC ONLOGON. Needs no elevation, but the peer only comes up
 *              after somebody signs in.
 *   "always" — /SC ONSTART. What a 24/7 hub actually needs (the phone and the
 *              MCP connector reach it whether or not anyone is at the desk),
 *              and it generally wants elevation plus a stored credential.
 */
export function startupScope(raw) {
  return raw === "always" ? "always" : "logon";
}

/** Tolerant parse of the signal file: anything unreadable means "no request". */
export function parseStartupRequest(text) {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || typeof v.enabled !== "boolean") return null;
    return { enabled: v.enabled, scope: startupScope(v.scope) };
  } catch {
    return null;
  }
}

export function serializeStartupRequest(enabled, scope) {
  return JSON.stringify({ enabled: !!enabled, scope: startupScope(scope) }) + "\n";
}

/**
 * The outcome the supervisor records after acting. `ok: false` is a normal,
 * expected state — registering the always-on scope without elevation fails —
 * so `command` carries what the owner can run in an Administrator prompt
 * instead. A silent failure here would be the worst kind: the owner ticks a
 * box, believes their hub survives a reboot, and finds out otherwise.
 */
/**
 * @param {{enabled: boolean, scope?: string, ok: boolean, detail?: string | null,
 *          command?: string | null, at?: string | null, caveat?: string | null}} o
 */
export function serializeStartupState(o) {
  const { enabled, scope, ok, detail = null, command = null, at = null, caveat = null } = o;
  return (
    JSON.stringify(
      {
        enabled: !!enabled,
        scope: startupScope(scope),
        ok: !!ok,
        detail: detail ?? null,
        command: command ?? null,
        caveat: caveat ?? null,
        at: at ?? new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
}

/** Tolerant parse of the recorded state; null when absent or unusable. */
export function parseStartupState(text) {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || typeof v.enabled !== "boolean") return null;
    return {
      enabled: v.enabled,
      scope: startupScope(v.scope),
      ok: v.ok === true,
      detail: typeof v.detail === "string" ? v.detail : null,
      command: typeof v.command === "string" ? v.command : null,
      caveat: typeof v.caveat === "string" ? v.caveat : null,
      at: typeof v.at === "string" ? v.at : null,
    };
  } catch {
    return null;
  }
}

// ── What to type at the hub-URL prompt (ADR-212) ─────────────────────────────
//
// Nothing in the wizard mentioned Tailscale, yet the whole hub story depends on
// it. Rather than a general tour, the ask was narrower and more useful: at the
// field where a hub URL goes, say what to put in it. So detect Tailscale by
// asking it, never by asking the owner to interpret anything.
//
// Counterpart: src/lib/network-addresses.ts does the same read for the app,
// which shows a hub its OWN addresses. Keep them in step.

/** Tolerant read of `tailscale status --json`. Anything unexpected reads as
 * "installed but not usable" rather than throwing. */
export function parseTailscaleJson(raw) {
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return { installed: true, running: false, dnsName: null, ips: [] };
  }
  const dns = typeof v?.Self?.DNSName === "string" ? v.Self.DNSName.replace(/\.$/, "") : "";
  const ips = Array.isArray(v?.Self?.TailscaleIPs)
    ? v.Self.TailscaleIPs.filter((i) => typeof i === "string" && !i.includes(":"))
    : [];
  return {
    installed: true,
    running: v?.BackendState === "Running",
    dnsName: dns || null,
    ips,
  };
}

/**
 * The help text for the hub-URL prompt, given what Tailscale reports and the
 * hub's app port. Pure so the wording is testable without a tailnet.
 *
 * Prefers the MagicDNS hostname over the raw 100.x: both work, but the
 * hostname is readable and survives a re-address.
 */
export function hubUrlHint(ts, port = 3000) {
  const lines = [];
  if (ts && ts.running && ts.dnsName) {
    const mine = ts.dnsName;
    const tailnet = mine.includes(".") ? mine.slice(mine.indexOf(".") + 1) : "your-tailnet.ts.net";
    lines.push(
      "Tailscale is running here, so use the hub's tailnet address:",
      `  http://<the-hub's-machine-name>.${tailnet}:${port}`,
      "",
      `This machine's own tailnet name is ${mine}, so the hub's looks the same`,
      "with its machine name in front. The hub shows you its exact address on its",
      "own Build → Network page — copy it from there rather than typing it out.",
      "",
      "The raw 100.x.y.z address works too, but the name is readable and keeps",
      "working if the addresses change."
    );
  } else if (ts && ts.installed && !ts.running) {
    lines.push(
      "Tailscale is installed here but not signed in yet, so it cannot reach a",
      "hub over the tailnet. Run `tailscale up`, sign in, and the hub's address",
      `will look like http://<machine>.<your-tailnet>.ts.net:${port}.`,
      "",
      "Without it, your options are limited: a LAN address",
      `(http://192.168.x.x:${port}) reaches the hub only from this same network,`,
      "or the hub has to be published on the internet, which is a bigger step."
    );
  } else {
    lines.push(
      "Tailscale is not installed here. It is the easy path: install it on both",
      "machines, sign both into the same tailnet, and the hub's address becomes",
      `http://<machine>.<your-tailnet>.ts.net:${port} from anywhere, with nothing`,
      "exposed to the internet.",
      "",
      "Without it: a LAN address like http://192.168.x.x:" + port + " works only",
      "while both machines are on the same network, or the hub has to be",
      "published publicly (a tunnel), which is a bigger step and only actually",
      "needed for callers that cannot join a tailnet."
    );
  }
  return lines.join("\n");
}

// ── The scheduled-task argv (win32) ──────────────────────────────────────────
// Pure argv builders so both the wizard and the supervisor register the task
// the same way, and `status` can read back what Windows actually holds.

/**
 * @param {{username: string, nodePath: string, supervisorScript: string,
 *          configPath: string, scope?: string}} o — an absent scope means the
 *          SAFE one (logon), never the one that demands elevation.
 */
export function schtasksCreateArgs(o) {
  const { username, nodePath, supervisorScript, configPath, scope = "logon" } = o;
  const always = startupScope(scope) === "always";
  return [
    "/Create",
    "/TN",
    STARTUP_TASK_NAME,
    "/SC",
    // Chosen deliberately (ADR-211). This used to be hardcoded ONSTART, which
    // quietly demanded elevation on every install.
    always ? "ONSTART" : "ONLOGON",
    // /RU only for the always-on scope, where the account has to be named
    // because the task runs with nobody signed in. For the logon scope the
    // default IS the current user, and naming them can pull in a password
    // requirement the scope exists to avoid.
    ...(always ? ["/RU", username] : []),
    "/TR",
    `"${nodePath}" "${supervisorScript}" "${configPath}"`,
    "/F", // idempotent: re-running replaces the task instead of erroring
  ];
}

export function schtasksDeleteArgs() {
  return ["/Delete", "/TN", STARTUP_TASK_NAME, "/F"];
}

export function schtasksQueryArgs() {
  return ["/Query", "/TN", STARTUP_TASK_NAME, "/FO", "LIST", "/V"];
}

/**
 * Read the registered scope back out of `schtasks /Query /FO LIST` output, so
 * `status` reports what Windows holds rather than what we last asked for.
 * Returns "always" | "logon" | null (registered but unrecognized).
 */
export function parseSchtasksScope(text) {
  if (/^\s*Schedule Type:\s*At system start ?up/im.test(text)) return "always";
  if (/^\s*Schedule Type:\s*At logon/im.test(text)) return "logon";
  return null;
}

// ── Registered, but will it actually run? (the ADR-211 honesty rule) ─────────
//
// schtasks /Create with /RU <user> and no /RP <password> succeeds and then
// quietly downgrades to "Interactive only": Windows runs the task ONLY while
// that user is signed in. On the always-on scope that is the exact failure the
// scope exists to prevent — the owner ticks a box, the registration reports
// success, and the hub does not come back from a boot nobody logged into.
//
// We cannot fix it for them: running with nobody signed in needs a stored
// credential, and asking for a Windows password is not ours to do. Windows'
// own Task Scheduler dialog collects it safely. So we report the truth and
// say where to go.

/** "interactive" (logged-on only), "background" (runs logged out), or null. */
export function parseSchtasksLogonMode(text) {
  const m = /^s*Logon Mode:s*(.+)$/im.exec(text);
  if (!m) return null;
  const v = m[1].trim().toLowerCase();
  if (v.startsWith("interactive only")) return "interactive";
  if (v.includes("background")) return "background";
  return null;
}

/**
 * The caveat to show beside a SUCCESSFUL registration, or null when there is
 * nothing to warn about. Only the always-on scope can be undercut this way:
 * the logon scope is interactive-only by definition and that is what it says.
 */
export function startupCaveat(scope, logonMode) {
  if (startupScope(scope) !== "always") return null;
  if (logonMode !== "interactive") return null;
  return (
    "Registered, but Windows will only run it while you are signed in — so a " +
    "reboot nobody logs into still leaves this peer down. Running with nobody " +
    "signed in needs your Windows password stored with the task, which only you " +
    "can enter: open Task Scheduler, find \"" + STARTUP_TASK_NAME + "\", and set " +
    "\"Run whether user is logged on or not\"."
  );
}
export function formatSchtasks(args) {
  return (
    "schtasks " +
    args.map((a) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a)).join(" ")
  );
}

// ── Single-instance ownership ────────────────────────────────────────────────
//
// One supervisor per dataDir, because two of them fight over everything that
// matters: they race for the update signal file (whoever polls first wins and
// the other never learns), they both try to bind appPort and dbPort, and they
// both drive the same Postgres cluster and the same live.json. Found the hard
// way on 2026-08-23: three had accumulated on one machine (stopping
// `npm run local:supervisor` kills npm and orphans the node child), an orphan
// ate an update signal, and the update failed where nobody could see it.
//
// This is not an exotic state. supervisor/README.md step 5 says run it in a
// terminal and step 7 says register it at boot; doing both, as intended,
// produces exactly two.

export function lockPath(dataDir) {
  return join(dataDir, "supervisor.lock");
}

/**
 * What to do when the lock file already exists.
 *
 * ponytail: identity is the pid alone, so a recycled pid reads as a live
 * owner and refuses a legitimate start. The cost is one manual delete of
 * supervisor.lock, the alternative is storing and comparing process start
 * times per platform, and the window needs a reboot plus a pid wrap to open.
 *
 * @param {number} recordedPid pid read from the lock file (NaN when garbage)
 * @param {number} ownPid this process
 * @param {boolean} alive whether recordedPid is a running process
 * @returns {"take" | "steal" | "mine" | "refuse"} take = no valid owner
 *   recorded, steal = the recorded owner is gone, mine = we already hold it,
 *   refuse = someone else is alive and owns this dataDir
 */
export function lockVerdict(recordedPid, ownPid, alive) {
  if (!Number.isInteger(recordedPid) || recordedPid <= 0) return "take";
  if (recordedPid === ownPid) return "mine";
  return alive ? "refuse" : "steal";
}

/** Tolerant parse: any malformed pointer reads as "no live build". */
export function parseLivePointer(text) {
  try {
    const v = JSON.parse(text);
    if (v && typeof v.dir === "string" && v.dir && typeof v.sha === "string" && v.sha) {
      return { dir: v.dir, sha: v.sha };
    }
  } catch {
    // fall through
  }
  return null;
}

export function serializeLivePointer(dir, sha) {
  return JSON.stringify({ dir, sha, flippedAt: new Date().toISOString() }, null, 2) + "\n";
}

/**
 * The keep-last-good rule, stated once: the pointer flips only when the build
 * AND the migrate both succeeded. Any failure keeps the previous build
 * serving.
 */
export function decideFlip({ buildOk, migrateOk }) {
  return buildOk === true && migrateOk === true ? "flip" : "keep";
}

/**
 * npm ci is needed only when the lockfile changed between the build being
 * served and the build being made (hashes of package-lock.json). A missing
 * previous hash (first build) also needs it.
 */
export function needsNpmCi(prevLockHash, nextLockHash) {
  return !prevLockHash || prevLockHash !== nextLockHash;
}

/**
 * Prune to the last N builds (default 2: live + one fallback). Input: the
 * build dir names (shas) with their creation order via mtimeMs, plus the live
 * sha, which is always kept regardless of age. Returns the shas to delete.
 */
export function pruneList(builds, liveSha, keep = 2) {
  const sorted = [...builds].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keepSet = new Set([liveSha]);
  for (const b of sorted) {
    if (keepSet.size >= keep) break;
    keepSet.add(b.sha);
  }
  return sorted.filter((b) => !keepSet.has(b.sha)).map((b) => b.sha);
}

// ── Crash restart backoff ────────────────────────────────────────────────────
// ponytail: plain exponential backoff capped at 60s, reset after a minute of
// uptime; upgrade to jitter/health-probes only if flapping is ever observed.

export function nextBackoffMs(consecutiveCrashes) {
  const n = Math.max(0, consecutiveCrashes);
  return Math.min(1000 * 2 ** n, 60_000);
}

// ── Local crons: the scheduler seam on a self-hosted peer (ADR-214) ──────────
//
// Scheduled work has always been triggered from OUTSIDE the app: vercel.json
// points Vercel cron at three endpoints, GitHub Actions hits the sub-daily
// ones. Both walk through the same door — GET /api/machine/<job> with a
// cron-scoped machine token — so the scheduler seam already exists at the HTTP
// layer. What a local peer lacks is a TRIGGER, and this is it: the supervisor
// is already a long-running process with timers in it and it knows the app's
// port, so it calls the same endpoints over loopback.
//
// The one that matters is `purge`, because it runs pruneSyncOps: without it a
// local peer's oplog never prunes and ADR-213's retention holds decide nothing.

/**
 * The catalog. Two questions per job, and the second one is the whole reason
 * this is a table rather than a list of paths:
 *
 *   `shared: true`  — safe when more than one peer runs it. Either idempotent,
 *                     or it writes only per-instance state (the oplog, a cache)
 *                     that no other peer can maintain on this peer's behalf.
 *   `shared: false` — EXCLUSIVE. It writes into a shared external system
 *                     (OneDrive, the Graph mailbox, Todoist, the transcription
 *                     provider) or creates items from one, so two peers doing
 *                     it is a conflict rather than a harmless repeat. Off by
 *                     default; turning one on is a deliberate statement that
 *                     this peer is the one that does it.
 *
 * `on` is the default. Only the two `shared` jobs default on, which is exactly
 * the set that is safe to run while the cloud deployment still runs everything
 * (alongside operation, ADR-206).
 */
export const LOCAL_JOBS = {
  purge: {
    path: "/api/machine/purge",
    label: "Trash purge and sync-oplog prune",
    at: "03:10",
    shared: true,
    on: true,
    why:
      "Every peer must run this itself: pruneSyncOps only ever prunes the oplog of " +
      "the instance it runs on. The hard deletes are the same decision from the same " +
      "data on every peer, and deleting an already-deleted row is a no-op.",
  },
  relatedness: {
    path: "/api/machine/relatedness",
    label: "Relatedness cache refresh",
    at: "03:40",
    shared: true,
    on: true,
    why:
      "item_relatedness is a per-instance cache, deliberately outside ADR-206's " +
      "synced-table list, so a local peer's Discover and Loose Ends stay empty until " +
      "it computes its own. Two peers filling their own caches is not a conflict.",
  },
  export: {
    path: "/api/machine/export",
    label: "OneDrive export",
    at: "04:10",
    shared: false,
    on: false,
    why: "One OneDrive folder. Two peers writing it would fight over the files and over items.exported_at.",
  },
  "calendar-sync": {
    path: "/api/machine/calendar-sync",
    label: "Calendar sync",
    everyMinutes: 240,
    shared: false,
    on: false,
    why: "Creates items from Graph events. Two peers matching the same event create two rows, and sync then propagates both.",
  },
  "email-import": {
    path: "/api/machine/email-import",
    label: "Email-in",
    everyMinutes: 240,
    shared: false,
    on: false,
    why: "Consumes the mailbox: whichever peer reads a message first is the only one that sees it, so the other silently imports nothing.",
  },
  "todoist-sync": {
    path: "/api/machine/todoist-sync",
    label: "Todoist sync",
    everyMinutes: 180,
    shared: false,
    on: false,
    why: "Bidirectional against one Todoist account. Two peers pushing the same tasks is the classic double-write.",
  },
  "transcription-poll": {
    path: "/api/machine/transcription-poll",
    label: "Transcription poll",
    everyMinutes: 15,
    shared: false,
    on: false,
    why: "Claims transcription jobs from the provider; two pollers race for the same job.",
  },
  "health-check": {
    path: "/api/machine/health-check",
    label: "Weekly health check",
    at: "07:00",
    shared: false,
    on: false,
    why: "Pushes to the owner's devices. Per-instance push subscriptions a local peer does not have, and it would double the alert where it does.",
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long after a failed attempt to try again (never past the next slot). */
export const CRON_RETRY_MS = 10 * 60 * 1000;

/** Grace after boot before an overdue job fires, so the app is up and the
 * first sync exchange is not competing with it. */
export const CRON_STARTUP_GRACE_MS = 3 * 60 * 1000;

/** How stale a successful run may get before the surfaces call it late. */
export const CRON_LATE_MULTIPLE = 3;

/** "HH:MM" to {h, m}, or null. Deliberately strict: a typo must not silently
 * become midnight. */
export function parseDailyAt(raw) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(raw ?? "").trim());
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

/**
 * The next occurrence of a local wall-clock HH:MM strictly after `from` (ms).
 * Local time on purpose — the owner of a machine under their desk thinks
 * "3am", not "08:00Z" — and via setHours/setDate so a DST boundary is the
 * platform's problem rather than ours.
 */
export function nextDailyAt(at, from) {
  const hm = parseDailyAt(at);
  if (!hm) return from + DAY_MS;
  const d = new Date(from);
  d.setHours(hm.h, hm.m, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Validate + resolve `config.crons` against the catalog.
 *
 * Shape, one shape only: an object keyed by job name, whose value is
 *   true              — on, with the catalog's own schedule
 *   false             — off
 *   {at}              — on, daily at this local HH:MM
 *   {everyMinutes}    — on, this often
 * An absent key keeps the catalog default. `crons: false` turns every job off
 * (what a dev rig wants). Throws on anything unusable, because a mistyped job
 * name that silently ran nothing is the failure this whole slice exists to
 * prevent.
 *
 * Returns the resolved list the runner works from.
 */
export function normalizeCrons(raw) {
  if (raw === false) return [];
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("config.crons must be an object keyed by job name, or false");
  }
  const req = raw ?? {};
  for (const name of Object.keys(req)) {
    if (!LOCAL_JOBS[name]) {
      throw new Error(
        `config.crons has no such job "${name}". Known jobs: ${Object.keys(LOCAL_JOBS).join(", ")}`
      );
    }
  }
  const out = [];
  for (const [name, def] of Object.entries(LOCAL_JOBS)) {
    const asked = Object.hasOwn(req, name);
    const v = asked ? req[name] : undefined;
    if (v === false) continue;
    if (asked && v !== true && (typeof v !== "object" || v === null || Array.isArray(v))) {
      throw new Error(`config.crons.${name} must be true, false, or an object with at/everyMinutes`);
    }
    if (!asked && !def.on) continue; // off by default and not asked for
    const o = v && typeof v === "object" ? v : {};

    let intervalMs = null;
    let at = null;
    if (o.everyMinutes !== undefined) {
      const n = Number(o.everyMinutes);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`config.crons.${name}.everyMinutes must be a positive number of minutes`);
      }
      intervalMs = n * 60_000;
    } else if (o.at !== undefined) {
      if (!parseDailyAt(o.at)) {
        throw new Error(
          `config.crons.${name}.at must be a 24-hour "HH:MM", got ${JSON.stringify(o.at)}`
        );
      }
      at = String(o.at).trim();
    } else if (def.everyMinutes) {
      intervalMs = def.everyMinutes * 60_000;
    } else {
      at = def.at;
    }
    out.push({
      name,
      path: def.path,
      label: def.label,
      shared: def.shared === true,
      intervalMs,
      at,
      periodMs: intervalMs ?? DAY_MS,
    });
  }
  return out;
}

export function cronStatePath(dataDir) {
  return join(dataDir, "cron-state.json");
}

/**
 * When a job should next run. `ok: false` brings it forward to a single soon
 * retry rather than losing a whole day to one bad moment (a run that landed
 * mid-build, say) — but never past the slot it was going to use anyway, so a
 * frequent job cannot be made more frequent by failing.
 */
export function nextRunAt(job, now, ok) {
  const scheduled = job.intervalMs ? now + job.intervalMs : nextDailyAt(job.at, now);
  return ok ? scheduled : Math.min(now + CRON_RETRY_MS, scheduled);
}

/**
 * The due time to adopt at boot for a job we may not have run in a while. A
 * peer that is asleep every night at 03:10 would otherwise never purge, which
 * is exactly the "the oplog never prunes" bug — so anything overdue by more
 * than its own period runs shortly after startup instead of waiting for a slot
 * it keeps missing.
 */
export function initialDueAt(job, lastOkAt, now) {
  const last = lastOkAt ? Date.parse(lastOkAt) : NaN;
  if (!Number.isFinite(last) || now - last > job.periodMs) return now + CRON_STARTUP_GRACE_MS;
  return nextRunAt(job, now, true);
}

/**
 * How a job reads to the owner. "failing" is the last attempt; "late" is a job
 * whose last SUCCESS is older than several periods, which is what a scheduler
 * that quietly stopped firing looks like from the outside.
 */
export function jobStaleness(entry, job, now) {
  if (!entry || (!entry.lastRunAt && !entry.lastOkAt)) return "never";
  if (entry.ok === false) return "failing";
  const lastOk = entry.lastOkAt ? Date.parse(entry.lastOkAt) : NaN;
  if (!Number.isFinite(lastOk)) return "never";
  return now - lastOk > job.periodMs * CRON_LATE_MULTIPLE ? "late" : "ok";
}

/**
 * The record the app and `local:status` read. Same posture as ADR-211's
 * startup-state.json: the supervisor writes what actually happened, including
 * the failures, because a peer that silently stopped exporting is the failure
 * this project keeps trying to make impossible.
 */
export function serializeCronState(jobs, entries, now = Date.now()) {
  return (
    JSON.stringify(
      {
        at: new Date(now).toISOString(),
        jobs: jobs.map((j) => {
          const e = entries[j.name] ?? {};
          return {
            name: j.name,
            label: j.label,
            path: j.path,
            shared: j.shared,
            everyMinutes: j.intervalMs ? Math.round(j.intervalMs / 60_000) : null,
            at: j.at ?? null,
            dueAt: e.dueAt ? new Date(e.dueAt).toISOString() : null,
            lastRunAt: e.lastRunAt ?? null,
            lastOkAt: e.lastOkAt ?? null,
            ok: e.ok ?? null,
            detail: e.detail ?? null,
            runs: e.runs ?? 0,
            fails: e.fails ?? 0,
            state: jobStaleness(e, j, now),
          };
        }),
      },
      null,
      2
    ) + "\n"
  );
}

/** Tolerant read: anything unusable means "no record", never a throw. */
export function parseCronState(text) {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || !Array.isArray(v.jobs)) return null;
    return {
      at: typeof v.at === "string" ? v.at : null,
      jobs: v.jobs.flatMap((j) =>
        j && typeof j.name === "string"
          ? [
              {
                name: j.name,
                label: typeof j.label === "string" ? j.label : j.name,
                path: typeof j.path === "string" ? j.path : "",
                shared: j.shared === true,
                everyMinutes: Number.isFinite(j.everyMinutes) ? j.everyMinutes : null,
                at: typeof j.at === "string" ? j.at : null,
                dueAt: typeof j.dueAt === "string" ? j.dueAt : null,
                lastRunAt: typeof j.lastRunAt === "string" ? j.lastRunAt : null,
                lastOkAt: typeof j.lastOkAt === "string" ? j.lastOkAt : null,
                ok: typeof j.ok === "boolean" ? j.ok : null,
                detail: typeof j.detail === "string" ? j.detail : null,
                runs: Number.isFinite(j.runs) ? j.runs : 0,
                fails: Number.isFinite(j.fails) ? j.fails : 0,
                state: ["ok", "late", "failing", "never"].includes(j.state) ? j.state : "never",
              },
            ]
          : []
      ),
    };
  } catch {
    return null;
  }
}

/**
 * The app-side entry the supervisor adds to LEDGR_API_TOKENS so its own calls
 * walk through the ordinary machine-token door (no bypass, no second auth
 * path). The raw token stays in the supervisor's memory and dies with the
 * process; only this hash reaches the child's env.
 */
export function localCronTokenEntry(hash) {
  return `local-cron:cron:${hash}`;
}

// ── Elevation: ask, rather than give up (ADR-211 follow-up) ──────────────────
//
// The "always" scope (/SC ONSTART) needs Administrator, and the supervisor runs
// unelevated, so schtasks returns access-denied. That used to be the end of it:
// the owner got the command to paste into an Administrator prompt themselves,
// which is a terminal in the middle of a GUI flow.
//
// A background process may not elevate SILENTLY, but it may ASK: ShellExecute's
// "runas" verb (Start-Process -Verb RunAs) raises the ordinary Windows consent
// dialog on the interactive desktop. So on failure we ask, and the owner clicks
// Yes in the same dialog every installer uses.
//
// The schtasks line goes through a temp .cmd file rather than being embedded in
// the PowerShell string. /TR already carries a fully-quoted command line, and
// threading those quotes through Node's argv escaping AND PowerShell's parser
// AND Start-Process's -ArgumentList is three layers of Windows quoting to get
// wrong. A file has no quoting problem at all.

/** ERROR_CANCELLED: the owner dismissed the consent dialog. Not a failure of ours. */
export const ELEVATION_CANCELLED = 1223;

/**
 * Contents of the temp .cmd that the elevated shell runs. Propagates schtasks'
 * exit code so the caller learns whether the task was actually created.
 * @param {string[]} args — the schtasks argv (schtasksCreateArgs/DeleteArgs)
 */
export function elevatedCmdScript(args) {
  return ["@echo off", formatSchtasks(args), "exit /b %ERRORLEVEL%", ""].join("\r\n");
}

/**
 * powershell argv that runs `scriptPath` elevated and exits with its code.
 * Only the path is interpolated, and a dataDir path cannot contain a single
 * quote on Windows (' is legal in a filename, so double it anyway rather than
 * trust that).
 * @param {string} scriptPath
 */
export function elevatedPowershellArgs(scriptPath) {
  const quoted = `'${scriptPath.replaceAll("'", "''")}'`;
  return [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `try { $p = Start-Process -FilePath ${quoted} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { exit ${ELEVATION_CANCELLED} }`,
  ];
}
