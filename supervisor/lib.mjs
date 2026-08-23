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
    // Extra env passed through to the app verbatim (R2 keys, Graph secrets…).
    extraEnv: cfg.extraEnv && typeof cfg.extraEnv === "object" ? { ...cfg.extraEnv } : {},
  };
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
 */
export function assembleAppEnv(cfg, buildSha) {
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
 *          command?: string | null, at?: string | null}} o
 */
export function serializeStartupState(o) {
  const { enabled, scope, ok, detail = null, command = null, at = null } = o;
  return (
    JSON.stringify(
      {
        enabled: !!enabled,
        scope: startupScope(scope),
        ok: !!ok,
        detail: detail ?? null,
        command: command ?? null,
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
      at: typeof v.at === "string" ? v.at : null,
    };
  } catch {
    return null;
  }
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
  return ["/Query", "/TN", STARTUP_TASK_NAME, "/FO", "LIST"];
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
