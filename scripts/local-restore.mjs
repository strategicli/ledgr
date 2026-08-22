// Fill the LOCAL embedded Postgres with initial data — the first-fill path
// for a new hub/spoke peer (LH2, ADR-206). Two sources:
//
//   npm run local:restore -- /path/to/ledgr-YYYY-MM-DD.dump [/path/to/config.json]
//   npm run local:restore -- --from-url <DIRECT Neon connection string> [/path/to/config.json]
//
// The dump form takes the backup workflow's custom-format file (pg_dump -Fc
// --no-owner --no-privileges, .github/workflows/backup.yml), pulled from
// OneDrive /Ledgr/Backups/. The --from-url form runs that same pg_dump
// itself, straight from the live Neon database, into a temp file it deletes
// when done — fresher than the weekly backup, and no hunting for the file.
//
// Either way, the restore half is identical from here: start the embedded
// cluster from the supervisor's data dir (initdb on first run) → drop/
// recreate the ledgr database → pg_restore → migrate to the bundled journal
// version → clear the sync state that must NOT be cloned from the hub:
//   - sync_ops truncated (this peer starts with an empty oplog)
//   - sync_device replaced (a fresh identity self-assigns; two peers sharing
//     a device id would corrupt cursoring)
//   - sync_peers truncated (device registrations belong to the hub)
//   - job_state sync cursors deleted (they were the HUB's cursors)
// A restored spoke then reconciles anything newer than the backup by its
// first full pull/push cycle against the hub (see supervisor/README.md).
//
// Needs `pg_restore` on PATH always, and `pg_dump` too for --from-url (the
// embedded binaries ship the server only):
// Windows: winget install PostgreSQL.PostgreSQL.18 (or the zip binaries);
// macOS: brew install libpq (then follow its PATH caveat).
//
// SAFETY: the RESTORE half never reads DATABASE_URL and only ever connects
// to 127.0.0.1 on the configured local port — it cannot touch Neon. The
// --from-url DUMP half is the one exception: it makes a single, read-only
// pg_dump connection to whatever host the caller passes on the command line.
// The connection string is never written to config.json, never logged, and
// not kept once the dump exists (see redactConnectionString below). Stop the
// supervisor before running either form (the cluster can't be started twice).
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(here, "..");
const { normalizeConfig, buildDbUrl } = await import(new URL("../supervisor/lib.mjs", import.meta.url));
const { redactConnectionString, refusePooledUrl } = await import(
  new URL("./local-setup-lib.mjs", import.meta.url)
);

const USAGE =
  "usage: npm run local:restore -- /path/to/ledgr-YYYY-MM-DD.dump [/path/to/config.json]\n" +
  "   or: npm run local:restore -- --from-url <DIRECT Neon connection string> [/path/to/config.json]";

function fail(msg) {
  throw new Error(msg);
}

/** Restore an already-produced custom-format dump file into the local
 * cluster. Shared by both source modes — this is the one description of
 * "restore this file", so neither mode reimplements it. Throws on any
 * failure; the caller decides how to report and clean up. */
async function restoreFromFile(dumpPath, cfg) {
  // A custom-format dump starts with the magic bytes PGDMP (same loud check
  // the backup workflow makes at dump time).
  {
    const fd = openSync(dumpPath, "r");
    const head = Buffer.alloc(5);
    readSync(fd, head, 0, 5, 0);
    closeSync(fd);
    if (head.toString("latin1") !== "PGDMP") {
      fail(`${dumpPath} is not a pg_dump custom-format file (no PGDMP magic).`);
    }
  }

  const restoreCheck = spawnSync("pg_restore", ["--version"], { encoding: "utf8" });
  if (restoreCheck.status !== 0) {
    fail(
      "pg_restore is not on PATH. Install the Postgres client tools:\n" +
        "  Windows: winget install PostgreSQL.PostgreSQL.18\n" +
        "  macOS:   brew install libpq && brew link --force libpq"
    );
  }
  console.log(`Restoring ${dumpPath}\n  into the local cluster at ${cfg.dataDir} (port ${cfg.dbPort})`);

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

  try {
    const adminUrl = `postgresql://postgres:postgres@127.0.0.1:${cfg.dbPort}/postgres`;
    const dbUrl = buildDbUrl(cfg);

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
    if (restore.status !== 0) fail("pg_restore failed");

    console.log("Migrating to the bundled journal version…");
    const mig = spawnSync(process.execPath, [join(repoDir, "scripts", "migrate.mjs")], {
      cwd: repoDir,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: dbUrl },
    });
    if (mig.status !== 0) fail("migrate failed");

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
  } finally {
    try {
      await cluster.stop();
    } catch {
      // best-effort
    }
  }
}

/** Dump the live database at `url` (a DIRECT, non-pooled connection string)
 * into a fresh temp file and return its path. Read-only against the remote
 * host; never persists or prints `url` itself. */
function dumpFromUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    fail("--from-url is not a valid connection string (couldn't parse a hostname from it).");
  }

  const refusal = refusePooledUrl(hostname);
  if (refusal) fail(refusal);

  const dumpCheck = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (dumpCheck.status !== 0) {
    fail(
      "pg_dump is not on PATH. Install the Postgres client tools:\n" +
        "  Windows: winget install PostgreSQL.PostgreSQL.18\n" +
        "  macOS:   brew install libpq && brew link --force libpq"
    );
  }

  const dumpPath = join(tmpdir(), `ledgr-restore-${randomUUID()}.dump`);
  console.log(`Dumping from ${hostname} ...`);
  const dump = spawnSync(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", "--file", dumpPath, url],
    { encoding: "utf8" }
  );
  if (dump.status !== 0) {
    // pg_dump can echo its own argument back into stderr on a bad
    // connection string — redact before this ever reaches the console.
    const stderr = redactConnectionString(dump.stderr ?? "", url);
    if (/version mismatch/i.test(stderr)) {
      fail(
        "pg_dump failed: the local Postgres CLIENT is older than the Neon server.\n" +
          "Install client tools at least as new as the Neon server version, then re-run:\n" +
          "  Windows: winget install PostgreSQL.PostgreSQL.18\n" +
          "  macOS:   brew install libpq && brew link --force libpq\n\n" +
          stderr
      );
    }
    fail(`pg_dump failed (see below).\n${stderr}`);
  }
  return dumpPath;
}

// ── Args + config ────────────────────────────────────────────────────────────

let values, positionals;
try {
  ({ values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { "from-url": { type: "string" } },
    allowPositionals: true,
  }));
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : err}\n\n${USAGE}`);
  process.exit(1);
}

const fromUrl = values["from-url"];
let dumpPath; // set below: either the given file, or pg_dump's temp output
let configPath;
if (fromUrl) {
  configPath = positionals[0] ? resolve(positionals[0]) : join(repoDir, "supervisor", "config.json");
} else {
  if (!positionals[0]) {
    console.error(`ERROR: ${USAGE}`);
    process.exit(1);
  }
  dumpPath = resolve(positionals[0]);
  configPath = positionals[1] ? resolve(positionals[1]) : join(repoDir, "supervisor", "config.json");
}

let exitCode = 0;
let tempDumpPath = null;
try {
  if (!existsSync(configPath)) {
    fail(`no supervisor config at ${configPath} — copy supervisor/config.example.json and edit it first.`);
  }
  const cfg = normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")), dirname(configPath));

  if (fromUrl) {
    tempDumpPath = dumpFromUrl(fromUrl);
    dumpPath = tempDumpPath;
  } else if (!existsSync(dumpPath)) {
    fail(`${dumpPath} does not exist`);
  }

  await restoreFromFile(dumpPath, cfg);
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  // The dump is a one-time bootstrap artifact, not something to keep around
  // — delete it whether the restore that follows succeeded or failed.
  if (tempDumpPath) {
    try {
      unlinkSync(tempDumpPath);
    } catch {
      // best-effort
    }
  }
}
process.exit(exitCode);
