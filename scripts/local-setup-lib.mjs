// Pure decision logic for the local-peer setup wizard (LH4, ADR-206 decision
// 10). Everything here is side-effect free and imported by
// scripts/verify-setup.mts; the prompt/spawn shell lives in local-setup.mjs
// and stays thin. Node builtins only.
import { parseArgs } from "node:util";
import { join } from "node:path";

// ── Flags ────────────────────────────────────────────────────────────────────
// Every interactive prompt has a flag override so the wizard can run
// unattended (--yes). parseArgs (node:util) throws a readable error on an
// unknown flag, which is exactly the behavior we want.

const OPTIONS = {
  role: { type: "string" }, // hub | spoke
  "data-dir": { type: "string" },
  "owner-email": { type: "string" },
  "hub-url": { type: "string" },
  "hub-token": { type: "string" },
  port: { type: "string" }, // app port
  "db-port": { type: "string" },
  backup: { type: "string" }, // path to a pg_dump file → implies --fill restore
  "from-url": { type: "string" }, // any Postgres connection string, pooled included → implies --fill pull
  fill: { type: "string" }, // restore | pull | seed | skip
  config: { type: "string" }, // where config.json is written (default supervisor/config.json)
  yes: { type: "boolean", default: false },
  force: { type: "boolean", default: false }, // allow overwriting an existing config.json
  "register-service": { type: "boolean", default: false }, // win32: run schtasks without asking
  help: { type: "boolean", default: false },
};

export function parseSetupArgs(argv) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }).values;
}

// ── Per-answer validators ────────────────────────────────────────────────────
// Each returns the normalized value or throws with a message the prompt loop
// can show before re-asking. supervisor/lib.mjs normalizeConfig re-validates
// the assembled whole; these exist so a typo is caught at the question, not
// after ten more answers.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // same shape seed.mjs refuses on

export function validateRole(v) {
  if (v !== "hub" && v !== "spoke") throw new Error(`role must be "hub" or "spoke", got ${JSON.stringify(v)}`);
  return v;
}

export function validateEmail(v) {
  if (typeof v !== "string" || !EMAIL_RE.test(v)) throw new Error(`"${v}" is not a valid email address`);
  return v;
}

export function validatePort(v, name = "port") {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`invalid ${name}: ${JSON.stringify(v)}`);
  return n;
}

export function validateHubUrl(v) {
  if (typeof v !== "string" || !/^https?:\/\/\S+$/.test(v)) {
    throw new Error(`hub URL must start with http:// or https://, got ${JSON.stringify(v)}`);
  }
  return v.replace(/\/+$/, "");
}

/** Where a peer's data lives when the user just presses Enter. */
export function defaultDataDir(platform, home) {
  // Matches config.example.json on Windows; a home subdir elsewhere.
  return platform === "win32" ? "C:/ledgr-data" : join(home, "ledgr-data");
}

/**
 * Which initial data fill to run. --backup implies restore, --from-url
 * implies pull; an explicit --fill wins over either; the default is seed
 * (start empty). "skip" is for re-running the wizard on a peer that already
 * has data. Passing both --backup and --from-url is rejected rather than
 * picking one silently.
 */
export function decideFill({ fill, backup, fromUrl }) {
  if (backup && fromUrl) {
    throw new Error("pass either --backup or --from-url, not both");
  }
  const resolved = fill ?? (backup ? "restore" : fromUrl ? "pull" : "seed");
  if (!["restore", "pull", "seed", "skip"].includes(resolved)) {
    throw new Error(`--fill must be restore, pull, seed, or skip, got ${JSON.stringify(resolved)}`);
  }
  if (resolved !== "restore" && backup) {
    throw new Error(`--backup only makes sense with the restore fill, not "${resolved}"`);
  }
  if (resolved !== "pull" && fromUrl) {
    throw new Error(`--from-url only makes sense with the pull fill, not "${resolved}"`);
  }
  return resolved;
}

/**
 * One-line, safe-to-print description of a chosen data fill. A connection
 * string is never included — "pull" always reads as "(connection string
 * set)" rather than showing the value, the same non-echo convention
 * configSummary uses for deviceToken.
 */
export function fillSummaryLine(fill, { backupPath } = {}) {
  switch (fill) {
    case "restore":
      return `Restoring the backup${backupPath ? ` (${backupPath})` : ""}`;
    case "pull":
      return "Pulling from the live database (connection string set)";
    case "seed":
      return "Starting empty (migrate + seed)";
    case "skip":
      return "Skipping the data fill (existing database left alone)";
    default:
      throw new Error(`unknown fill: ${JSON.stringify(fill)}`);
  }
}

// ── Live-pull helpers (scripts/local-restore.mjs's --from-url mode) ─────────
// Pure so verify-setup.mts can exercise them without a real Neon connection
// string.
//
// There used to be a refusePooledUrl helper here: pg_dump needs a DIRECT
// (unpooled) connection, since it opens more than one connection and expects
// session state to persist across them, which the pgbouncer-based Neon
// pooler does not support. The live pull is native now (scripts/lib/pg-copy.mjs,
// plain `pg` SELECTs through the `pg` driver), so that restriction is gone:
// an ordinary pooled connection reads rows just fine. Any Neon connection
// string, pooled or direct, works.

/** Strip a connection string out of arbitrary text before it reaches the
 * console or an error message — a defensive measure in case a `pg` error
 * ever echoes its connection argument back (drivers sometimes do on a bad
 * host/auth failure). */
export function redactConnectionString(text, url) {
  return url ? text.split(url).join("<connection-string>") : text;
}

// ── Config assembly ──────────────────────────────────────────────────────────

/**
 * The supervisor/config.json a fresh peer gets. Shape mirrors
 * config.example.json; supervisor/lib.mjs normalizeConfig is the validator of
 * record (the shell round-trips through it before writing).
 *
 * Sync arms only when hubs AND deviceToken are both set (assembleAppEnv's
 * gate), so a hub — which in v1 never syncs upstream — gets an empty hubs
 * list and no token. A hub that later becomes a spoke of another hub edits
 * hubs/deviceToken in config.json by hand.
 */
export function buildPeerConfig({ role, dataDir, ownerEmail, appPort, dbPort, hubUrl, hubToken }) {
  const spoke = role === "spoke";
  return {
    role,
    dataDir,
    repoDir: "..",
    branch: "main",
    appPort,
    dbPort,
    ownerEmail,
    hubs: spoke && hubUrl ? [hubUrl] : [],
    deviceToken: spoke && hubToken ? hubToken : "",
    update: { mode: "prompted", pollIntervalMs: 900000 },
    cadence: { pushDebounceMs: 2000, pullMs: 10000 },
    extraEnv: {},
  };
}

/**
 * Never clobber an existing config without --force. Returns the refusal
 * message, or null when writing is allowed (the peers.ts deleteRefusal shape).
 */
export function configWriteRefusal(exists, force) {
  return exists && !force
    ? "config.json already exists; re-run with --force to overwrite it (the summary above shows what would change)."
    : null;
}

/**
 * Diff-style summary lines shown before writing: "  key = value" for
 * unchanged/new-file lines, "~ key = old -> new" where an existing config
 * differs. The device token is never printed (it is a credential).
 *
 * @param {Record<string, unknown>} next
 * @param {Record<string, unknown> | null} [existing]
 * @returns {string[]}
 */
export function configSummary(next, existing = null) {
  const flat = (obj, prefix = "") =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? flat(v, `${prefix}${k}.`)
        : [[`${prefix}${k}`, k === "deviceToken" ? (v ? "(set)" : '""') : JSON.stringify(v)]]
    );
  const prev = existing ? new Map(flat(existing)) : null;
  return flat(next).map(([k, v]) => {
    const old = prev?.get(k);
    return prev && old !== v ? `~ ${k} = ${old ?? "(unset)"} -> ${v}` : `  ${k} = ${v}`;
  });
}

// ── Service registration (win32) ─────────────────────────────────────────────
// The exact schtasks command from supervisor/README.md, built from real paths.
// One source of truth: the args array is what spawnSync runs, and the display
// string is derived from it.

export function schtasksCreateArgs({ username, nodePath, supervisorScript, configPath }) {
  return [
    "/Create",
    "/TN",
    "Ledgr Supervisor",
    "/SC",
    "ONSTART",
    "/RU",
    username,
    "/TR",
    `"${nodePath}" "${supervisorScript}" "${configPath}"`,
    "/F", // idempotent: re-running the wizard replaces the task instead of erroring
  ];
}

export function formatSchtasks(args) {
  return (
    "schtasks " +
    args.map((a) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a)).join(" ")
  );
}
