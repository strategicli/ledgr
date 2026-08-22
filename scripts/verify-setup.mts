// Verification for the LH4 installer + setup wizard (ADR-206 decision 10).
// PURE on purpose: the wizard's decisions (flag parsing, validators, config
// assembly for hub vs spoke, never-clobber, the schtasks command) live in
// scripts/local-setup-lib.mjs precisely so this script can exercise them with
// no prompts, no Postgres, and no child processes; install.ps1 and the
// local-setup.mjs shell are checked as text.
//
// NOTE this file must never contain the literal name of the database
// connection env var (or the other backend markers) — verify-ci.mjs would
// classify it as backend-needing and silently drop it from CI.
//
// Run: npx tsx scripts/verify-setup.mts
import { existsSync, readFileSync } from "node:fs";
import { assembleAppEnv, normalizeConfig } from "../supervisor/lib.mjs";
import {
  buildPeerConfig,
  configSummary,
  configWriteRefusal,
  decideFill,
  defaultDataDir,
  fillSummaryLine,
  formatSchtasks,
  parseSetupArgs,
  redactConnectionString,
  schtasksCreateArgs,
  validateEmail,
  validateHubUrl,
  validatePort,
  validateRole,
} from "./local-setup-lib.mjs";
import {
  buildInsertSql,
  buildPageQuery,
  buildSetvalSql,
  EXCLUDED_TABLES,
  isCopyableTable,
  rowsPerBatch,
} from "./lib/pg-copy.mjs";

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

// ── (1) Flag parsing ─────────────────────────────────────────────────────────

const flags = parseSetupArgs([
  "--role", "spoke",
  "--data-dir", "/data/ledgr",
  "--owner-email", "a@b.com",
  "--hub-url", "https://hub.example.com/",
  "--hub-token", "tok",
  "--port", "3100",
  "--db-port", "5544",
  "--backup", "/tmp/x.dump",
  "--yes",
]);
check(
  "flags parse to their values",
  flags.role === "spoke" &&
    flags["data-dir"] === "/data/ledgr" &&
    flags["owner-email"] === "a@b.com" &&
    flags.port === "3100" &&
    flags["db-port"] === "5544" &&
    flags.backup === "/tmp/x.dump" &&
    flags.yes === true
);
check("booleans default off", parseSetupArgs([]).yes === false && parseSetupArgs([]).force === false);
check("an unknown flag throws (typos fail loudly)", throws(() => parseSetupArgs(["--rol", "hub"])));
check("a positional argument throws", throws(() => parseSetupArgs(["hub"])));
check(
  "--from-url parses",
  parseSetupArgs(["--from-url", "postgresql://u:p@h/db", "--yes"])["from-url"] === "postgresql://u:p@h/db"
);

// ── (2) Validators ───────────────────────────────────────────────────────────

check("role hub/spoke pass", validateRole("hub") === "hub" && validateRole("spoke") === "spoke");
check("role anything else throws", throws(() => validateRole("both")) && throws(() => validateRole("")));
check("email validates", validateEmail("a@b.com") === "a@b.com" && throws(() => validateEmail("not-an-email")));
check(
  "port validates 1..65535 integers",
  validatePort("3000") === 3000 && throws(() => validatePort("0")) && throws(() => validatePort("70000")) && throws(() => validatePort("abc"))
);
check(
  "hub URL requires http(s) and drops the trailing slash",
  validateHubUrl("https://hub.example.com/") === "https://hub.example.com" && throws(() => validateHubUrl("hub.example.com"))
);
check(
  "default data dir: C:/ledgr-data on win32, ~/ledgr-data elsewhere",
  defaultDataDir("win32", "C:/Users/b") === "C:/ledgr-data" && defaultDataDir("darwin", "/Users/b").endsWith("ledgr-data")
);

// ── (3) Fill decision ────────────────────────────────────────────────────────

check(
  "default fill is seed (start empty)",
  decideFill({ fill: undefined, backup: undefined, fromUrl: undefined }) === "seed"
);
check(
  "--backup implies restore",
  decideFill({ fill: undefined, backup: "/x.dump", fromUrl: undefined }) === "restore"
);
check("explicit skip works", decideFill({ fill: "skip", backup: undefined, fromUrl: undefined }) === "skip");
check("an unknown fill throws", throws(() => decideFill({ fill: "clone", backup: undefined, fromUrl: undefined })));
check(
  "--backup with a non-restore fill throws",
  throws(() => decideFill({ fill: "seed", backup: "/x.dump", fromUrl: undefined }))
);
check(
  "--from-url implies pull",
  decideFill({ fill: undefined, backup: undefined, fromUrl: "postgresql://u:p@h/db" }) === "pull"
);
check("explicit pull works", decideFill({ fill: "pull", backup: undefined, fromUrl: undefined }) === "pull");
check(
  "--from-url with a non-pull fill throws",
  throws(() => decideFill({ fill: "seed", backup: undefined, fromUrl: "postgresql://u:p@h/db" }))
);
check(
  "--backup and --from-url together throws (no silent pick)",
  throws(() => decideFill({ fill: undefined, backup: "/x.dump", fromUrl: "postgresql://u:p@h/db" }))
);

// ── (3b) Live-pull helpers: redaction (no pooled-URL refusal any more — the
// native copy reads with plain SELECTs, so a pooled connection is fine) ─────

{
  const secret = "postgresql://user:pw@ep-cool-mountain-123456-pooler.us-east-2.aws.neon.tech/ledgr";
  const echoed = `error: connection to server at "${secret}" failed`;
  check(
    "redactConnectionString strips a connection string out of an echoed error",
    !redactConnectionString(echoed, secret).includes(secret)
  );
  check("redactConnectionString is a no-op with no secret to strip", redactConnectionString("plain text", undefined) === "plain text");
}
check(
  "fillSummaryLine never shows a connection string for pull",
  fillSummaryLine("pull") === "Pulling from the live database (connection string set)"
);
check(
  "fillSummaryLine has a line for every fill mode",
  fillSummaryLine("restore").length > 0 &&
    fillSummaryLine("seed").length > 0 &&
    fillSummaryLine("skip").length > 0
);

// ── (4) Config assembly: hub vs spoke ────────────────────────────────────────

const hubAnswers = {
  role: "hub",
  dataDir: "/data/ledgr",
  ownerEmail: "a@b.com",
  appPort: 3000,
  dbPort: 5433,
  hubUrl: undefined,
  hubToken: undefined,
};
const hubCfg = buildPeerConfig(hubAnswers);
const spokeCfg = buildPeerConfig({
  ...hubAnswers,
  role: "spoke",
  hubUrl: "https://hub.example.com",
  hubToken: "tok123",
});

check("a hub gets no hubs list and no device token (v1: hub never syncs upstream)", hubCfg.hubs.length === 0 && hubCfg.deviceToken === "");
check("a spoke gets its hub + token", spokeCfg.hubs.length === 1 && spokeCfg.hubs[0] === "https://hub.example.com" && spokeCfg.deviceToken === "tok123");
check("both roles carry update + cadence defaults", hubCfg.update.mode === "prompted" && hubCfg.cadence.pullMs === 10000 && spokeCfg.cadence.pushDebounceMs === 2000);

// Round-trip through the supervisor's own validator — the exact parse it does
// at boot — then through env assembly, proving the sync vars land only on
// spokes (assembleAppEnv's both-halves gate).
const hubNorm = normalizeConfig(hubCfg, "/repo/supervisor");
const spokeNorm = normalizeConfig(spokeCfg, "/repo/supervisor");
check("the assembled hub config passes normalizeConfig", hubNorm.role === "hub" && hubNorm.ownerEmail === "a@b.com");
check("the assembled spoke config passes normalizeConfig", spokeNorm.role === "spoke" && spokeNorm.deviceToken === "tok123");

const hubEnv = assembleAppEnv(hubNorm, "sha");
const spokeEnv = assembleAppEnv(spokeNorm, "sha");
check("hub env has NO sync vars", hubEnv.LEDGR_SYNC_HUBS === undefined && hubEnv.LEDGR_SYNC_TOKEN === undefined);
check("spoke env has both sync vars", spokeEnv.LEDGR_SYNC_HUBS === "https://hub.example.com" && spokeEnv.LEDGR_SYNC_TOKEN === "tok123");
check("both envs carry the owner identity", hubEnv.LEDGR_LOCAL_OWNER_EMAIL === "a@b.com" && spokeEnv.LEDGR_LOCAL_OWNER_EMAIL === "a@b.com");

// ── (5) Never clobber without --force ────────────────────────────────────────

check("existing config + no --force refuses", typeof configWriteRefusal(true, false) === "string");
check("existing config + --force writes", configWriteRefusal(true, true) === null);
check("no existing config writes", configWriteRefusal(false, false) === null);

// ── (6) Summary (diff-style, token never printed) ────────────────────────────

const summary = configSummary(spokeCfg, { ...spokeCfg, appPort: 3001, deviceToken: "OLD_SECRET" });
check(
  "a changed key gets a diff marker",
  summary.some((l: string) => l.startsWith("~ appPort") && l.includes("3001") && l.includes("3000"))
);
check("unchanged keys print plainly", summary.some((l: string) => l.startsWith("  role")));
check(
  "the device token value is never printed",
  !summary.join("\n").includes("tok123") &&
    !summary.join("\n").includes("OLD_SECRET") &&
    summary.some((l: string) => l.includes("deviceToken"))
);
check("a fresh config (no existing) has no diff markers", configSummary(hubCfg).every((l: string) => l.startsWith("  ")));

// ── (7) The schtasks command ─────────────────────────────────────────────────

const args = schtasksCreateArgs({
  username: "brandon",
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  supervisorScript: "C:\\ledgr\\supervisor\\ledgr-supervisor.mjs",
  configPath: "C:\\ledgr\\supervisor\\config.json",
});
const cmd = formatSchtasks(args);
check(
  "schtasks: ONSTART task named Ledgr Supervisor (the README command)",
  args.includes("/SC") && args.includes("ONSTART") && cmd.includes('"Ledgr Supervisor"')
);
check(
  "schtasks: node, the supervisor script, and the config are all in /TR, each quoted",
  args[args.indexOf("/TR") + 1] === '"C:\\Program Files\\nodejs\\node.exe" "C:\\ledgr\\supervisor\\ledgr-supervisor.mjs" "C:\\ledgr\\supervisor\\config.json"'
);
check("schtasks: /F so a re-run replaces the task (idempotent wizard)", args.includes("/F"));

// ── (8) install.ps1 structure (text checks; no PowerShell tooling assumed) ──

check("install.ps1 exists at the repo root", existsSync("install.ps1"));
const ps1 = readFileSync("install.ps1", "utf8");
const repoUrlCount = ps1.split("https://github.com/strategicli/ledgr").length - 1;
check("the pinned repo URL appears exactly once", repoUrlCount === 1, `found ${repoUrlCount}`);
check(
  "no hardcoded secrets (no token/secret/password assignments)",
  !/\$(token|secret|password|apikey)\s*=/i.test(ps1) && !/Bearer\s+[A-Za-z0-9]/.test(ps1)
);
check("bootstraps git and Node LTS via winget", ps1.includes("Git.Git") && ps1.includes("OpenJS.NodeJS.LTS"));
check("names the manual downloads when winget is absent", ps1.includes("git-scm.com") && ps1.includes("nodejs.org"));
check("installs dependencies with npm ci", ps1.includes("npm ci"));
check("hands off to the cross-platform wizard", ps1.includes("local-setup.mjs"));
check("pull-if-present (idempotent re-run)", ps1.includes("pull --ff-only"));
check(
  "PowerShell 5.1 compatible: no PS7-only operators",
  !ps1.includes("&&") && !ps1.includes("??") && !/\?\s*:/.test(ps1)
);
check("install.ps1's usage comment points to install.cmd as the double-click entry point", ps1.includes("install.cmd"));
check(
  "install.ps1 also bootstraps the Postgres client tools (the backup-file restore path needs them; the live pull does not)",
  ps1.includes("PostgreSQL.PostgreSQL.18") && ps1.includes("pg_restore")
);
check(
  "install.ps1 finds an already-installed Postgres bin folder even when it never made it onto PATH",
  ps1.includes("pg_restore.exe") && ps1.includes("Program Files\\PostgreSQL")
);

// ── (8b) install.cmd (text checks; the double-click entry point) ────────────

check("install.cmd exists at the repo root", existsSync("install.cmd"));
const installCmd = readFileSync("install.cmd", "utf8");
check("install.cmd references install.ps1", installCmd.includes("install.ps1"));
check("install.cmd keeps the window open (pause) so errors are readable", /pause/i.test(installCmd));
check("install.cmd carries the pinned repo's raw URL as a fetch fallback", installCmd.includes("raw.githubusercontent.com/strategicli/ledgr"));
check(
  "no hardcoded secret pattern in install.cmd",
  !/\b(token|secret|password|apikey)\s*=/i.test(installCmd) && !/Bearer\s+[A-Za-z0-9]/.test(installCmd)
);
check("install.cmd passes through arguments (e.g. -InstallDir)", installCmd.includes("%*"));

// ── (9) The wizard shell (text checks) ───────────────────────────────────────

const wizard = readFileSync("scripts/local-setup.mjs", "utf8");
check("the wizard's decisions come from the lib", wizard.includes('from "./local-setup-lib.mjs"'));
check("the wizard validates with the supervisor's own normalizeConfig", wizard.includes("normalizeConfig"));
check("prompts use node:readline/promises (builtins only)", wizard.includes('"node:readline/promises"'));
check("restore delegates to scripts/local-restore.mjs", wizard.includes("local-restore.mjs"));
check("the wizard's pull path also delegates to scripts/local-restore.mjs", wizard.includes("--from-url"));
check(
  "start-empty runs migrate before seed (new-instance.mjs's order)",
  wizard.indexOf('["migrate"') > 0 && wizard.indexOf('["migrate"') < wizard.indexOf('["seed"')
);
check("the wizard never duplicates the supervisor's build logic", !wizard.includes("next build") && !wizard.includes("next/dist/bin"));
check("the config write honors the clobber rule", wizard.includes("configWriteRefusal"));

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check("npm run local:setup is wired", pkg.scripts["local:setup"] === "node scripts/local-setup.mjs");

const seedSrc = readFileSync("scripts/seed.mjs", "utf8");
check(
  "seed.mjs carries the driver branch (local Postgres path for start-empty)",
  seedSrc.includes('import("pg")') && seedSrc.includes("isNeon")
);

const readme = readFileSync("supervisor/README.md", "utf8");
check("the README's bring-up leads with install.cmd (the double-click entry point)", readme.includes("install.cmd"));
check("the README keeps the PowerShell invocation as the alternative", readme.includes("install.ps1"));
check("the README keeps the manual fallback checklist", readme.includes("manual fallback"));
check(
  "the README documents the live-pull option as needing no extra tools, any connection string",
  readme.includes("no extra tools") && readme.includes("pooled")
);

// ── (10) The native pg-copy engine's pure helpers ────────────────────────────
// The connected discovery/copy functions (listCopyableTables, copyAllTables,
// etc.) need a real database — that's scripts/verify-pg-copy.mts, gated on
// embedded-postgres the same way verify-sync.mts is. These are the parts
// that don't: the exclusion list, batch sizing, and the SQL shapes.

check(
  "the never-clone set excludes exactly the per-peer sync tables",
  isCopyableTable("items") &&
    isCopyableTable("relations") &&
    !isCopyableTable("sync_ops") &&
    !isCopyableTable("sync_peers") &&
    !isCopyableTable("sync_device"),
  [...EXCLUDED_TABLES].join(", ")
);

check(
  "rowsPerBatch stays under the 65535 bound-parameter cap",
  rowsPerBatch(20) * 20 <= 65535 && rowsPerBatch(1) * 1 <= 65535 && rowsPerBatch(9999) * 9999 <= 65535
);
check("rowsPerBatch caps at maxRows even when the param cap allows more", rowsPerBatch(1, { maxRows: 500 }) === 500);
check(
  "rowsPerBatch shrinks for wide tables (more columns, fewer rows per batch)",
  rowsPerBatch(4) > rowsPerBatch(400)
);
check("rowsPerBatch refuses a non-positive column count", throws(() => rowsPerBatch(0)));

{
  const plain = buildInsertSql("items", ["id", "title"], 2);
  check(
    "buildInsertSql with no conflict column produces a plain INSERT, placeholders numbered sequentially",
    plain === 'insert into "items" ("id", "title") values ($1, $2), ($3, $4)'
  );
  const upsert = buildInsertSql("items", ["id", "title"], 1, "id");
  check(
    "buildInsertSql with a conflict column upserts every OTHER column from excluded (a fresh migrated dest can already hold this row — types, sync_schema_ver — and a second pull must be idempotent)",
    upsert === 'insert into "items" ("id", "title") values ($1, $2) on conflict ("id") do update set "title" = excluded."title"'
  );
  const singleCol = buildInsertSql("sync_schema_ver", ["ver"], 1, "ver");
  check(
    "buildInsertSql falls back to DO NOTHING when the pk is the only column (nothing else to set)",
    singleCol === 'insert into "sync_schema_ver" ("ver") values ($1) on conflict ("ver") do nothing'
  );
  check("buildInsertSql refuses zero rows", throws(() => buildInsertSql("items", ["id"], 0)));
}

{
  const { firstText, text } = buildPageQuery("items", ["id", "title"], "id", 500);
  check(
    "buildPageQuery's first page has no WHERE (no cursor yet)",
    firstText === 'select "id", "title" from "items" order by "id" limit 500'
  );
  check(
    "buildPageQuery's later pages key off the cursor as a bound parameter",
    text === 'select "id", "title" from "items" where "id" > $1 order by "id" limit 500'
  );
}

check(
  "buildSetvalSql realigns past the max copied value, floored at 1 for an empty table",
  buildSetvalSql("items_seq", "items", "seq") ===
    'select setval(\'items_seq\', coalesce((select max("seq") from "items"), 1))'
);


// Windows ESM guard (regression, 2026-08-22): `require.resolve()` returns an
// absolute filesystem path, and on Windows `import("C:\\...")` throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME because "C:" parses as a URL scheme. It works
// on macOS and Linux, so only a real Windows run catches it, which is exactly
// how it reached Brandon's install. Every dynamic import of a resolved path
// must go through pathToFileURL().href.
for (const rel of [
  "scripts/local-setup.mjs",
  "scripts/local-restore.mjs",
  "supervisor/ledgr-supervisor.mjs",
]) {
  const src = readFileSync(rel, "utf8");
  const bad = [...src.matchAll(/await import\(([^)]*resolve\([^)]*\))\)/g)].filter(
    (m) => !m[1].includes("pathToFileURL")
  );
  check(`${rel} wraps every resolved dynamic import in pathToFileURL (Windows ESM)`, bad.length === 0);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
