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
  needsNpmCi,
  nextBackoffMs,
  normalizeConfig,
  parseLivePointer,
  pruneList,
  serializeLivePointer,
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

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
