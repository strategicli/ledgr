#!/usr/bin/env node
// The local-peer setup wizard (LH4, ADR-206 decision 10): everything after
// install.ps1's clone-and-npm-ci, on any platform. Interactive by default;
// every prompt has a flag override so it also runs unattended:
//
//   npm run local:setup
//   node scripts/local-setup.mjs --role hub --data-dir /data --owner-email a@b.com --yes
//   node scripts/local-setup.mjs --role spoke --hub-url https://hub --hub-token TOK \
//     --backup /path/to/ledgr-YYYY-MM-DD.dump --yes
//
// What it does, in order: preflight → questions (or flags) → write
// supervisor/config.json (never clobbering without --force) → initial data
// fill (restore a pg_dump, or pull straight from the live database, both via
// scripts/local-restore.mjs, or migrate+seed an empty database in
// new-instance.mjs's order) → service registration (Task Scheduler on win32;
// printed instructions elsewhere) → summary.
// The first APP BUILD is deliberately not here: the supervisor builds the
// repo's HEAD on its own first start (LH2), and duplicating that would drift.
// Decision logic lives in local-setup-lib.mjs (pure, verified by
// scripts/verify-setup.mts); this file is the prompt/spawn shell.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { homedir, userInfo } from "node:os";
import { stdin, stdout } from "node:process";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { buildDbUrl, normalizeConfig } from "../supervisor/lib.mjs";
import {
  buildPeerConfig,
  configSummary,
  configWriteRefusal,
  decideFill,
  defaultDataDir,
  fillSummaryLine,
  formatSchtasks,
  parseSetupArgs,
  schtasksCreateArgs,
  validateEmail,
  validateHubUrl,
  validatePort,
  validateRole,
} from "./local-setup-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(here, "..");

function fail(msg) {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

const USAGE = `Ledgr local-peer setup wizard.

  npm run local:setup            interactive
  node scripts/local-setup.mjs [flags]

Flags (each replaces one prompt; --yes answers the rest with defaults):
  --role hub|spoke        what this machine is
  --data-dir <path>       where Postgres data + builds live (outside the repo)
  --port <n>              app port (default 3000)
  --db-port <n>           Postgres port (default 5433)
  --owner-email <email>   the local owner identity (must match the users row)
  --hub-url <url>         spoke only: the hub to sync against
  --hub-token <token>     spoke only: the one-time device token minted on the hub
  --backup <path>         restore this pg_dump as the initial data (implies --fill restore)
  --from-url <url>        pull the initial data live from this DIRECT (unpooled) Neon
                          connection string (implies --fill pull)
  --fill restore|pull|seed|skip  initial data fill (default seed = start empty)
  --config <path>         where to write config.json (default supervisor/config.json)
  --force                 overwrite an existing config.json
  --register-service      win32: run the schtasks registration without asking
  --yes                   no prompts; fail if a required flag is missing
`;

let flags;
try {
  flags = parseSetupArgs(process.argv.slice(2));
} catch (err) {
  fail(`${err instanceof Error ? err.message : err}\n\n${USAGE}`);
}
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

// ── Preflight ────────────────────────────────────────────────────────────────

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  fail(`Node ${process.versions.node} is too old. Install the current LTS (20+) and re-run.`);
}
if (spawnSync("git", ["--version"], { encoding: "utf8" }).status !== 0) {
  fail("git is not on PATH. Install git, then re-run (the supervisor pulls updates with it).");
}
const pkgPath = join(repoDir, "package.json");
let pkgName = null;
try {
  pkgName = JSON.parse(readFileSync(pkgPath, "utf8")).name;
} catch {
  // handled below
}
if (pkgName !== "ledgr") {
  fail(`this doesn't look like the ledgr repo (no package.json named "ledgr" at ${repoDir}).`);
}
if (!existsSync(join(repoDir, "node_modules", "embedded-postgres"))) {
  fail("dependencies are missing — run `npm ci` in the repo first (install.ps1 does this for you).");
}

console.log("Ledgr local-peer setup\n");

// ── Questions (or flags) ─────────────────────────────────────────────────────

const rl = flags.yes ? null : readline.createInterface({ input: stdin, output: stdout });

/**
 * One answer: the flag wins; otherwise prompt (with default) until the
 * validator accepts; in --yes mode the default answers, and a question with
 * no default fails naming its flag.
 */
async function answer(question, { flagValue, flagName, def, validate = (v) => v }) {
  if (flagValue !== undefined) return validate(flagValue);
  if (!rl) {
    if (def !== undefined) return validate(def);
    fail(`--yes needs ${flagName} (there is no default for: ${question})`);
  }
  for (;;) {
    const suffix = def !== undefined ? ` [${def}]` : "";
    const raw = (await rl.question(`${question}${suffix}: `)).trim();
    try {
      return validate(raw === "" && def !== undefined ? def : raw);
    } catch (err) {
      console.log(`  ${err instanceof Error ? err.message : err}`);
    }
  }
}

if (!flags.role && rl) {
  console.log(
    "A HUB is the always-on machine other devices sync against; it holds the\n" +
      "device registry and, after cutover, serves your phone and MCP. A SPOKE is\n" +
      "any other machine: it runs the same full app locally and syncs its data\n" +
      "against a hub using a device token you mint there.\n"
  );
}
const role = await answer("Role (hub or spoke)", {
  flagValue: flags.role,
  flagName: "--role",
  validate: validateRole,
});

const dataDir = resolve(
  await answer("Data directory (Postgres cluster + app builds; outside the repo)", {
    flagValue: flags["data-dir"],
    flagName: "--data-dir",
    def: defaultDataDir(process.platform, homedir()),
  })
);
const appPort = await answer("App port", {
  flagValue: flags.port,
  flagName: "--port",
  def: "3000",
  validate: (v) => validatePort(v, "app port"),
});
const dbPort = await answer("Postgres port", {
  flagValue: flags["db-port"],
  flagName: "--db-port",
  def: "5433",
  validate: (v) => validatePort(v, "db port"),
});

if (!flags["owner-email"] && rl) {
  console.log(
    "\nThe owner email becomes LEDGR_LOCAL_OWNER_EMAIL: the identity this peer\n" +
      "signs you in as, with no login screen. It must match the users row in the\n" +
      "data this peer holds (restored or seeded), or every page renders empty.\n"
  );
}
const ownerEmail = await answer("Owner email", {
  flagValue: flags["owner-email"],
  flagName: "--owner-email",
  validate: validateEmail,
});

let hubUrl;
let hubToken;
if (role === "spoke") {
  if (!flags["hub-url"] && rl) {
    console.log(
      "\nA spoke needs its hub's URL and a device token. Mint the token on the\n" +
        "hub: Build → Updates → Synced devices → Add device (it is shown once).\n"
    );
  }
  hubUrl = await answer("Hub URL", {
    flagValue: flags["hub-url"],
    flagName: "--hub-url",
    validate: validateHubUrl,
  });
  hubToken = await answer("Device token", {
    flagValue: flags["hub-token"],
    flagName: "--hub-token",
    validate: (v) => {
      if (!v) throw new Error("the device token is required (mint it on the hub)");
      return v;
    },
  });
}

// Initial data fill. Restore is the fast path for a real dataset; seed makes
// a valid empty database (a syncing spoke then reconciles by its first full
// pull, which for a large dataset is much slower than restoring the dump).
let fill;
try {
  fill = decideFill({ fill: flags.fill, backup: flags.backup, fromUrl: flags["from-url"] });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (flags.fill === undefined && flags.backup === undefined && flags["from-url"] === undefined && rl) {
  console.log(
    "\nInitial data, three ways: 'restore' loads a weekly pg_dump backup file\n" +
      "(the fast path when you already have one from OneDrive /Ledgr/Backups/).\n" +
      "'pull' connects straight to the live Neon database instead — it's the\n" +
      "freshest option, but needs the DIRECT (unpooled) connection string from\n" +
      "the Neon dashboard, not the pooler one the app itself uses. 'seed' starts\n" +
      "empty (a spoke then pulls everything from the hub on first sync — correct,\n" +
      "but slow for large data); 'skip' leaves the database alone (re-running the\n" +
      "wizard on an existing peer).\n"
  );
  fill = await answer("Initial data (restore, pull, seed, or skip)", {
    flagValue: undefined,
    flagName: "--fill",
    def: "seed",
    validate: (v) => decideFill({ fill: v, backup: undefined, fromUrl: undefined }),
  });
}
let backupPath = flags.backup ? resolve(flags.backup) : undefined;
if (fill === "restore" && !backupPath) {
  if (!rl) fail("--fill restore needs --backup <path to the .dump file>");
  backupPath = resolve(
    await answer("Path to the .dump backup file", {
      flagValue: undefined,
      flagName: "--backup",
      validate: (v) => {
        if (!existsSync(resolve(v))) throw new Error(`no file at ${resolve(v)}`);
        return v;
      },
    })
  );
}
let fromUrl = flags["from-url"];
if (fill === "pull" && !fromUrl) {
  if (!rl) fail("--fill pull needs --from-url <direct Neon connection string>");
  fromUrl = await answer("Live database connection string (DIRECT, not the pooler one)", {
    flagValue: undefined,
    flagName: "--from-url",
    validate: (v) => {
      if (!v) throw new Error("a connection string is required");
      return v;
    },
  });
}

// ── Write supervisor/config.json ─────────────────────────────────────────────

const configPath = flags.config ? resolve(flags.config) : join(repoDir, "supervisor", "config.json");
const config = buildPeerConfig({ role, dataDir, ownerEmail, appPort, dbPort, hubUrl, hubToken });
// The validator of record: the exact parse the supervisor does at boot.
const normalized = normalizeConfig(config, dirname(configPath));

let existing = null;
if (existsSync(configPath)) {
  try {
    existing = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    existing = null; // unreadable counts as existing for the clobber rule below
  }
}
console.log(`\nConfig → ${configPath}`);
for (const line of configSummary(config, existing)) console.log(line);

const refusal = configWriteRefusal(existsSync(configPath), flags.force);
if (refusal) fail(refusal);

if (rl) {
  const go = (await rl.question("\nWrite this config? [Y/n] ")).trim();
  if (/^n/i.test(go)) {
    console.log("Nothing written.");
    process.exit(0);
  }
}
mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("Config written.");

// ── Initial data fill ────────────────────────────────────────────────────────

/**
 * Start empty: initdb the embedded cluster if needed, then migrate → seed in
 * new-instance.mjs's order (seed.mjs creates the system types AND the owner
 * row from SEED_OWNER_EMAIL, so this is its steps 1-3 against the local DB).
 * Reused as child processes, not reimplemented: those scripts are the one
 * description of a fresh database.
 */
async function startEmpty(cfg) {
  const requireFromRepo = createRequire(join(repoDir, "package.json"));
  const EmbeddedPostgres = (await import(requireFromRepo.resolve("embedded-postgres"))).default;
  const pgDir = join(cfg.dataDir, "pg");
  mkdirSync(cfg.dataDir, { recursive: true });
  const cluster = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: "postgres",
    password: "postgres",
    port: cfg.dbPort,
    persistent: true,
  });
  if (!existsSync(join(pgDir, "PG_VERSION"))) {
    console.log("initdb (first run)…");
    await cluster.initialise();
  }
  try {
    await cluster.start();
  } catch (err) {
    throw new Error(
      `could not start the local Postgres (is the supervisor already running? stop it first): ${err instanceof Error ? err.message : err}`
    );
  }
  try {
    try {
      await cluster.createDatabase("ledgr");
    } catch {
      // already exists — fine, migrate and seed are both idempotent
    }
    const dbUrl = buildDbUrl(cfg);
    const steps = [
      ["migrate", {}],
      ["seed", { SEED_OWNER_EMAIL: cfg.ownerEmail }],
    ];
    for (const [name, extraEnv] of steps) {
      console.log(`${name}…`);
      const res = spawnSync(process.execPath, [join(repoDir, "scripts", `${name}.mjs`)], {
        cwd: repoDir,
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: dbUrl, ...extraEnv },
      });
      if (res.status !== 0) throw new Error(`${name} failed (see output above)`);
    }
  } finally {
    try {
      await cluster.stop();
    } catch {
      // best-effort
    }
  }
}

if (fill === "restore") {
  console.log(`\n${fillSummaryLine(fill, { backupPath })} (scripts/local-restore.mjs)…`);
  const res = spawnSync(
    process.execPath,
    [join(repoDir, "scripts", "local-restore.mjs"), backupPath, configPath],
    { cwd: repoDir, stdio: "inherit" }
  );
  if (res.status !== 0) {
    fail("restore failed (see above). The config is written; fix the issue and re-run just the restore: npm run local:restore -- " + backupPath);
  }
} else if (fill === "pull") {
  console.log(`\n${fillSummaryLine(fill)} (scripts/local-restore.mjs)…`);
  const res = spawnSync(
    process.execPath,
    [join(repoDir, "scripts", "local-restore.mjs"), "--from-url", fromUrl, configPath],
    { cwd: repoDir, stdio: "inherit" }
  );
  if (res.status !== 0) {
    fail(
      "pull failed (see above). The config is written; fix the issue and re-run just the pull: " +
        "npm run local:restore -- --from-url <connection-string> " + configPath
    );
  }
} else if (fill === "seed") {
  console.log(`\n${fillSummaryLine(fill)}…`);
  try {
    await startEmpty(normalized);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  if (role === "spoke") {
    console.log(
      "Note: this spoke starts empty and reconciles by its FIRST FULL PULL from\n" +
        "the hub. That is correct but slow for a large dataset — restoring a\n" +
        "recent backup (npm run local:restore) is the fast path."
    );
  }
} else {
  console.log(`\n${fillSummaryLine(fill)}.`);
}

// ── First build ──────────────────────────────────────────────────────────────
// Deliberately the supervisor's job: its first run builds the repo's current
// HEAD, migrates, and serves (LH2). Duplicating that pipeline here would drift.
console.log(
  "\nThe app builds on the supervisor's FIRST START (a few minutes); nothing to do here."
);

// ── Service registration ─────────────────────────────────────────────────────

const supervisorScript = join(repoDir, "supervisor", "ledgr-supervisor.mjs");
if (process.platform === "win32") {
  const args = schtasksCreateArgs({
    username: userInfo().username,
    nodePath: process.execPath,
    supervisorScript,
    configPath,
  });
  console.log("\nRegister the supervisor to run at boot (Task Scheduler):\n  " + formatSchtasks(args));
  let runIt = flags["register-service"];
  if (!runIt && rl) {
    runIt = /^y/i.test((await rl.question("Run it now? [y/N] ")).trim());
  }
  if (runIt) {
    const res = spawnSync("schtasks", args, { stdio: "inherit" });
    if (res.status === 0) {
      console.log('Registered. Start it without rebooting: schtasks /Run /TN "Ledgr Supervisor"');
    } else {
      console.log(
        "schtasks failed — it may need an elevated prompt. Copy the command above\n" +
          "into an Administrator PowerShell, or skip it and start the supervisor by hand."
      );
    }
  } else {
    console.log("Skipped. Run the command above whenever you want boot registration.");
  }
} else if (process.platform === "darwin") {
  console.log(
    "\nTo run at boot on macOS (launchd), create\n" +
      "~/Library/LaunchAgents/org.ledgr.supervisor.plist with RunAtLoad=true and\n" +
      `ProgramArguments = [${process.execPath}, ${supervisorScript}, ${configPath}],\n` +
      "then: launchctl load ~/Library/LaunchAgents/org.ledgr.supervisor.plist"
  );
} else {
  console.log(
    "\nTo run at boot on Linux (systemd user unit), create\n" +
      "~/.config/systemd/user/ledgr-supervisor.service with\n" +
      `ExecStart=${process.execPath} ${supervisorScript} ${configPath} and Restart=always,\n` +
      "then: systemctl --user enable --now ledgr-supervisor"
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(
  `\nDone. This machine is a ${role}.\n` +
    `  config     ${configPath}\n` +
    `  data       ${dataDir}\n` +
    `  start now  npm run local:supervisor   (first start builds the app)\n` +
    `  app        http://localhost:${appPort}\n` +
    `  health     http://localhost:${appPort}/health\n` +
    `  sync/updates status  http://localhost:${appPort}/build/updates`
);
if (role === "spoke") {
  console.log(
    "\nThe device token you pasted was one-time: it is now stored (hashed) on the\n" +
      "hub's Synced-devices row, and revoking this device lives there too\n" +
      "(hub → Build → Updates → Synced devices)."
  );
}
rl?.close();
