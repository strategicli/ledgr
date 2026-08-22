// Restore a weekly pg_dump backup into the LOCAL embedded Postgres — the
// first-fill path for a new hub/spoke peer (LH2, ADR-206). Usage:
//
//   npm run local:restore -- /path/to/ledgr-YYYY-MM-DD.dump [/path/to/config.json]
//
// The dump is the backup workflow's custom-format file (pg_dump -Fc --no-owner
// --no-privileges, .github/workflows/backup.yml), pulled from OneDrive
// /Ledgr/Backups/. Steps: start the embedded cluster from the supervisor's
// data dir (initdb on first run) → drop/recreate the ledgr database →
// pg_restore → migrate to the bundled journal version → clear the sync state
// that must NOT be cloned from the hub:
//   - sync_ops truncated (this peer starts with an empty oplog)
//   - sync_device replaced (a fresh identity self-assigns; two peers sharing
//     a device id would corrupt cursoring)
//   - sync_peers truncated (device registrations belong to the hub)
//   - job_state sync cursors deleted (they were the HUB's cursors)
// A restored spoke then reconciles anything newer than the backup by its
// first full pull/push cycle against the hub (see supervisor/README.md).
//
// Needs `pg_restore` on PATH (the embedded binaries ship the server only):
// Windows: winget install PostgreSQL.PostgreSQL.18 (or the zip binaries);
// macOS: brew install libpq (then follow its PATH caveat).
//
// SAFETY: this script never reads DATABASE_URL and only ever connects to
// 127.0.0.1 on the configured local port. It cannot touch Neon. Stop the
// supervisor before running (the cluster can't be started twice).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(here, "..");
const { normalizeConfig, buildDbUrl } = await import(
  new URL("../supervisor/lib.mjs", import.meta.url)
);

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ── Args + preflight ─────────────────────────────────────────────────────────

const dumpPath = process.argv[2] && resolve(process.argv[2]);
if (!dumpPath || !existsSync(dumpPath)) {
  fail("usage: npm run local:restore -- /path/to/ledgr-YYYY-MM-DD.dump [/path/to/config.json]");
}
// A custom-format dump starts with the magic bytes PGDMP (same loud check the
// backup workflow makes at dump time).
{
  const fd = openSync(dumpPath, "r");
  const head = Buffer.alloc(5);
  readSync(fd, head, 0, 5, 0);
  closeSync(fd);
  if (head.toString("latin1") !== "PGDMP") {
    fail(`${dumpPath} is not a pg_dump custom-format file (no PGDMP magic).`);
  }
}

const configPath = process.argv[3]
  ? resolve(process.argv[3])
  : join(repoDir, "supervisor", "config.json");
if (!existsSync(configPath)) {
  fail(`no supervisor config at ${configPath} — copy supervisor/config.example.json and edit it first.`);
}
const { readFileSync } = await import("node:fs");
const cfg = normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")), dirname(configPath));

const restoreCheck = spawnSync("pg_restore", ["--version"], { encoding: "utf8" });
if (restoreCheck.status !== 0) {
  fail(
    "pg_restore is not on PATH. Install the Postgres client tools:\n" +
      "  Windows: winget install PostgreSQL.PostgreSQL.18\n" +
      "  macOS:   brew install libpq && brew link --force libpq"
  );
}
console.log(`Restoring ${dumpPath}\n  into the local cluster at ${cfg.dataDir} (port ${cfg.dbPort})`);

// ── Embedded Postgres up ─────────────────────────────────────────────────────

const requireFromRepo = createRequire(join(repoDir, "package.json"));
const EmbeddedPostgres = (await import(requireFromRepo.resolve("embedded-postgres"))).default;
const pg = (await import(requireFromRepo.resolve("pg"))).default;

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
  console.log("First run: initdb…");
  await cluster.initialise();
}
try {
  await cluster.start();
} catch (err) {
  fail(
    `could not start the local Postgres (is the supervisor still running? stop it first): ${err instanceof Error ? err.message : err}`
  );
}

const adminUrl = `postgresql://postgres:postgres@127.0.0.1:${cfg.dbPort}/postgres`;
const dbUrl = buildDbUrl(cfg);
let exitCode = 0;

try {
  // Clean slate: the restore must not merge into leftovers.
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query("drop database if exists ledgr with (force)");
  await admin.query("create database ledgr");
  await admin.end();

  console.log("pg_restore…");
  const restore = spawnSync(
    "pg_restore",
    ["--no-owner", "--no-privileges", "--exit-on-error", "-d", dbUrl, dumpPath],
    { stdio: "inherit" }
  );
  if (restore.status !== 0) throw new Error("pg_restore failed");

  console.log("Migrating to the bundled journal version…");
  const mig = spawnSync(process.execPath, [join(repoDir, "scripts", "migrate.mjs")], {
    cwd: repoDir,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  if (mig.status !== 0) throw new Error("migrate failed");

  console.log("Clearing cloned sync state (fresh device identity)…");
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  await db.query("truncate sync_ops");
  await db.query("delete from sync_device");
  // Re-run the 0054 seed insert: a fresh identity self-assigns.
  await db.query(
    "insert into sync_device (id) select gen_random_uuid() where not exists (select 1 from sync_device)"
  );
  await db.query("truncate sync_peers");
  await db.query("delete from job_state where key like 'sync:cursor:%'");
  await db.end();

  console.log(
    "\nRestore complete. Start the peer with `npm run local:supervisor`.\n" +
      "If this peer syncs against a hub, its first pull/push cycle reconciles\n" +
      "everything newer than the backup — expect a burst of ops, then steady state."
  );
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  try {
    await cluster.stop();
  } catch {
    // best-effort
  }
}
process.exit(exitCode);
