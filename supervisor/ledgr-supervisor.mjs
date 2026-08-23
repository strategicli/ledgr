#!/usr/bin/env node
// The local-peer supervisor (plan phase 2 / LH2, ADR-206 decision 6): ONE
// long-running process that owns everything a local Ledgr peer needs —
// embedded Postgres, the app (`next start` from the current live build), and
// the update apply path (the local half of ADR-194).
//
//   npm run local:supervisor           # config from supervisor/config.json
//   node supervisor/ledgr-supervisor.mjs /path/to/config.json
//
// Update flow (signal file <dataDir>/update-requested, written by the app's
// "Update now" button, or self-written in update.mode "auto"):
//   git pull → fresh worktree checkout in builds/<sha>/ → node_modules (npm ci
//   only if the lockfile changed, else copied from the live build) →
//   next build → migrate → flip live.json → restart the app into the new dir.
// ANY failure leaves the previous build serving (keep-last-good; the flip is
// the last step and only decideFlip says when). Builds are self-contained on
// purpose: nothing ever mutates the directory the running app serves from,
// which is also why this works on Windows (you cannot swap files a process
// is serving from). Kept to node builtins + the repo's own embedded-postgres.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rmDirBestEffort, rmDirRetry } from "./rm-dir.mjs";
import {
  assembleAppEnv,
  buildDbUrl,
  lockPath,
  lockVerdict,
  buildsDir,
  decideFlip,
  livePointerPath,
  needsNpmCi,
  nextBackoffMs,
  normalizeConfig,
  parseLivePointer,
  pruneList,
  serializeLivePointer,
  signalPath,
  formatSchtasks,
  parseStartupRequest,
  schtasksCreateArgs,
  schtasksDeleteArgs,
  serializeStartupState,
  startupSignalPath,
  startupStatePath,
  stopSignalPath,
  STARTUP_TASK_NAME,
} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function log(msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), source: "supervisor", msg, ...extra }));
}

// ── Config ───────────────────────────────────────────────────────────────────

const configPath = process.argv[2] ? resolve(process.argv[2]) : join(here, "config.json");
if (!existsSync(configPath)) {
  console.error(`No config at ${configPath}. Copy supervisor/config.example.json to supervisor/config.json and edit it.`);
  process.exit(1);
}
const cfg = normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")), dirname(configPath));
mkdirSync(cfg.dataDir, { recursive: true });
mkdirSync(buildsDir(cfg.dataDir), { recursive: true });
log("config loaded", { role: cfg.role, dataDir: cfg.dataDir, appPort: cfg.appPort, dbPort: cfg.dbPort, updateMode: cfg.update.mode });

// ── Small helpers (shell side) ───────────────────────────────────────────────

const isWin = process.platform === "win32";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin && cmd === "npm", // npm is npm.cmd on Windows
    ...opts,
  });
  return { ok: res.status === 0, stdout: (res.stdout ?? "").trim(), stderr: (res.stderr ?? "").trim() };
}

function git(args, cwd = cfg.repoDir) {
  return run("git", args, { cwd });
}

function lockHash(dir) {
  const p = join(dir, "package-lock.json");
  if (!existsSync(p)) return null;
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

// ── Embedded Postgres ────────────────────────────────────────────────────────

// Resolve embedded-postgres from the repo clone (it is a runtime dependency
// there); the supervisor dir itself has no node_modules.
const requireFromRepo = createRequire(join(cfg.repoDir, "package.json"));
const EmbeddedPostgres = (await import(pathToFileURL(requireFromRepo.resolve("embedded-postgres")).href)).default;

// Which @embedded-postgres/<platform> package holds the binaries, so pg_ctl
// can be found beside the postgres binary for a graceful shutdown.
const PG_PLATFORM_PKG = `${process.platform === "win32" ? "windows" : process.platform}-${
  process.arch === "arm64" ? "arm64" : "x64"
}`;

const pgDir = join(cfg.dataDir, "pg");
const firstRun = !existsSync(join(pgDir, "PG_VERSION"));
const pg = new EmbeddedPostgres({
  databaseDir: pgDir,
  user: "postgres",
  password: "postgres",
  port: cfg.dbPort,
  persistent: true,
  // See scripts/local-restore.mjs: a Windows-default cluster is WIN1252 and
  // cannot hold real body text. UTF8 is not optional here.
  initdbFlags: ["--encoding=UTF8", "--locale-provider=icu", "--icu-locale=en-US", "--locale=C"],
});

async function startPostgres() {
  if (firstRun && !existsSync(join(pgDir, "PG_VERSION"))) {
    log("initdb (first run)", { pgDir });
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase("ledgr");
    log("created database ledgr");
  } catch {
    // already exists — the normal case after the first boot
  }
  log("postgres up", { port: cfg.dbPort });
}

// ── The app child ────────────────────────────────────────────────────────────

let appChild = null;
let appCrashes = 0;
let shuttingDown = false;
let restartTimer = null;

function liveBuild() {
  const p = livePointerPath(cfg.dataDir);
  if (!existsSync(p)) return null;
  const ptr = parseLivePointer(readFileSync(p, "utf8"));
  if (!ptr || !existsSync(join(ptr.dir, ".next"))) return null;
  return ptr;
}

function startApp(ptr) {
  const nextBin = join(ptr.dir, "node_modules", "next", "dist", "bin", "next");
  const env = { ...process.env, ...assembleAppEnv(cfg, ptr.sha) };
  appChild = spawn(process.execPath, [nextBin, "start", "-p", String(cfg.appPort)], {
    cwd: ptr.dir,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const child = appChild;
  log("app started", { pid: child.pid, sha: ptr.sha.slice(0, 7), dir: ptr.dir, port: cfg.appPort });
  const startedAt = Date.now();
  child.on("exit", (code, sig) => {
    if (child !== appChild || shuttingDown) return; // superseded or deliberate
    appCrashes = Date.now() - startedAt > 60_000 ? 0 : appCrashes + 1;
    const wait = nextBackoffMs(appCrashes);
    log("app exited; restarting", { code, sig, inMs: wait });
    restartTimer = setTimeout(() => {
      const cur = liveBuild();
      if (cur && !shuttingDown) startApp(cur);
    }, wait);
    restartTimer.unref?.();
  });
}

function stopApp() {
  return new Promise((done) => {
    const child = appChild;
    appChild = null;
    if (!child || child.exitCode !== null) return done();
    const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("exit", () => {
      clearTimeout(force);
      done();
    });
    child.kill("SIGTERM"); // on win32 Node terminates the process for us
  });
}

// ── The update apply path (keep-last-good) ───────────────────────────────────

let updating = false;

async function applyUpdate(reason, { pull = true } = {}) {
  if (updating) return;
  updating = true;
  try {
    log("update starting", { reason });
    if (pull) {
      const pulled = git(["pull", "--ff-only", "origin", cfg.branch]);
      if (!pulled.ok) {
        log("update FAILED: git pull", { stderr: pulled.stderr });
        return;
      }
    }
    const head = git(["rev-parse", "HEAD"]);
    if (!head.ok) {
      log("update FAILED: rev-parse", { stderr: head.stderr });
      return;
    }
    const sha = head.stdout;
    const live = liveBuild();
    if (live?.sha === sha) {
      log("already serving this commit; nothing to do", { sha: sha.slice(0, 7) });
      return;
    }
    const dir = join(buildsDir(cfg.dataDir), sha);

    // Fresh checkout: a git worktree of the repo clone at the target sha. The
    // running app's directory is never touched.
    if (existsSync(dir)) {
      git(["worktree", "remove", "--force", dir]); // a previous failed attempt
      rmDirRetry(dir);
      git(["worktree", "prune"]);
    }
    const wt = git(["worktree", "add", "--detach", dir, sha]);
    if (!wt.ok) {
      log("update FAILED: worktree add", { stderr: wt.stderr });
      return;
    }

    let buildOk = false;
    let migrateOk = false;
    try {
      // node_modules: real directory per build (Turbopack rejects symlinked
      // node_modules). npm ci only when the lockfile changed; otherwise copy
      // the live build's tree — nothing the running app serves from is
      // mutated either way.
      if (live && !needsNpmCi(lockHash(live.dir), lockHash(dir))) {
        log("lockfile unchanged; copying node_modules from live build");
        cpSync(join(live.dir, "node_modules"), join(dir, "node_modules"), {
          recursive: true,
          verbatimSymlinks: true,
        });
      } else {
        log("running npm ci", { dir });
        const ci = run("npm", ["ci"], { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
        if (!ci.ok) {
          log("update FAILED: npm ci", { stderr: ci.stderr });
          return;
        }
      }

      log("building", { sha: sha.slice(0, 7) });
      const nextBin = join(dir, "node_modules", "next", "dist", "bin", "next");
      const build = run(process.execPath, [nextBin, "build"], {
        cwd: dir,
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, NODE_ENV: "production" },
      });
      buildOk = build.ok;
      if (!buildOk) {
        log("update FAILED: next build (previous build keeps serving)");
        return;
      }

      log("migrating local database");
      const mig = run(process.execPath, [join(dir, "scripts", "migrate.mjs")], {
        cwd: dir,
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, DATABASE_URL: buildDbUrl(cfg) },
      });
      migrateOk = mig.ok;
      if (!migrateOk) {
        log("update FAILED: migrate (previous build keeps serving)");
        return;
      }
    } finally {
      if (decideFlip({ buildOk, migrateOk }) === "flip") {
        await stopApp();
        writeFileSync(livePointerPath(cfg.dataDir), serializeLivePointer(dir, sha));
        log("flipped live pointer", { sha: sha.slice(0, 7) });
        startApp({ dir, sha });
        pruneBuilds(sha);
      } else {
        // keep-last-good: drop the failed attempt so a retry starts clean.
        git(["worktree", "remove", "--force", dir]);
        rmDirRetry(dir);
        git(["worktree", "prune"]);
      }
    }
  } finally {
    updating = false;
  }
}

function pruneBuilds(liveSha) {
  const root = buildsDir(cfg.dataDir);
  const builds = readdirSync(root).flatMap((name) => {
    try {
      const st = statSync(join(root, name));
      return st.isDirectory() ? [{ sha: name, mtimeMs: st.mtimeMs }] : [];
    } catch {
      return [];
    }
  });
  for (const sha of pruneList(builds, liveSha, 2)) {
    const dir = join(root, sha);
    log("pruning old build", { sha: sha.slice(0, 7) });
    git(["worktree", "remove", "--force", dir]);
    // Best-effort: on Windows the app process we just stopped may still
    // hold handles in here. A build left behind is disk usage the next
    // prune clears, never a reason to fail an update that already flipped.
    const err = rmDirBestEffort(dir);
    if (err) log("prune deferred (directory still in use)", { sha: sha.slice(0, 7), error: String(err) });
  }
  git(["worktree", "prune"]);
}

// ── Signal watching + auto poll ──────────────────────────────────────────────
// ponytail: a 2s existsSync poll instead of fs.watch — watch semantics differ
// per platform and a signal file arrives at most a few times a week.

const signal = signalPath(cfg.dataDir);
setInterval(() => {
  if (!existsSync(signal) || updating) return;
  let target = "";
  try {
    target = readFileSync(signal, "utf8").trim();
    unlinkSync(signal);
  } catch {
    return; // mid-write; next tick gets it
  }
  void applyUpdate(target ? `signal (target ${target.slice(0, 7)})` : "signal");
}, 2000).unref?.();

// A graceful stop, asked for through a file (ADR-211). `npm run local:stop`
// writes it rather than signalling the pid, because on Windows a "SIGTERM"
// from another process is a hard terminate: the handler below never runs, so
// Postgres gets killed instead of shut down and the lock file survives looking
// like a live owner. Reaching the same shutdown path a Ctrl-C reaches is the
// whole point.
const stopSignal = stopSignalPath(cfg.dataDir);
setInterval(() => {
  if (!existsSync(stopSignal)) return;
  try {
    unlinkSync(stopSignal);
  } catch {
    return; // mid-write; next tick gets it
  }
  void shutdown("stop-requested");
}, 2000).unref?.();

// ── "Start when Windows starts" (ADR-211) ────────────────────────────────────
//
// The app's toggle cannot register a scheduled task itself, so it writes a
// request here and this — a local process the owner started — carries it out.
// Deliberately the SAME signal-file mechanism as the update above rather than
// a second pattern.
//
// The outcome is recorded either way, because the failure is expected: the
// always-on scope generally needs elevation, and this process usually is not
// elevated. An owner who ticks a box and is not told it failed believes their
// hub survives a reboot when it does not.
const startupSignal = startupSignalPath(cfg.dataDir);

function applyStartupRequest(req) {
  const script = join(here, "ledgr-supervisor.mjs");
  const args = req.enabled
    ? schtasksCreateArgs({
        username: process.env.USERNAME || process.env.USER || "",
        nodePath: process.execPath,
        supervisorScript: script,
        configPath,
        scope: req.scope,
      })
    : schtasksDeleteArgs();

  if (!isWin) {
    writeFileSync(
      startupStatePath(cfg.dataDir),
      serializeStartupState({
        enabled: req.enabled,
        scope: req.scope,
        ok: false,
        detail:
          "Boot registration is only automated on Windows so far. On macOS use a " +
          "launchd plist, on Linux a systemd user unit — see supervisor/README.md.",
      }),
      "utf8"
    );
    log("startup request not automated on this platform", { platform: process.platform });
    return;
  }

  const res = run("schtasks", args);
  const ok = res.ok;
  writeFileSync(
    startupStatePath(cfg.dataDir),
    serializeStartupState({
      enabled: req.enabled,
      scope: req.scope,
      ok,
      detail: ok
        ? null
        : (res.stderr || res.stdout || "schtasks failed").trim().split("\n")[0] ||
          "schtasks failed",
      // The escape hatch, given verbatim: the owner can paste this into an
      // Administrator prompt and get the same result.
      command: ok ? null : formatSchtasks(args),
    }),
    "utf8"
  );
  log(ok ? "startup registration updated" : "startup registration FAILED", {
    task: STARTUP_TASK_NAME,
    enabled: req.enabled,
    scope: req.scope,
  });
}

setInterval(() => {
  if (!existsSync(startupSignal)) return;
  let raw = "";
  try {
    raw = readFileSync(startupSignal, "utf8");
    unlinkSync(startupSignal);
  } catch {
    return; // mid-write; next tick gets it
  }
  const req = parseStartupRequest(raw);
  if (!req) {
    log("ignoring an unreadable startup request");
    return;
  }
  applyStartupRequest(req);
}, 2000).unref?.();

if (cfg.update.mode === "auto") {
  setInterval(() => {
    if (updating) return;
    const fetch = git(["fetch", "origin", cfg.branch]);
    if (!fetch.ok) return;
    const local = git(["rev-parse", "HEAD"]).stdout;
    const remote = git(["rev-parse", `origin/${cfg.branch}`]).stdout;
    if (local && remote && local !== remote) void applyUpdate("auto poll");
  }, cfg.update.pollIntervalMs).unref?.();
}

// ── Boot + shutdown ──────────────────────────────────────────────────────────

// One supervisor per dataDir (see lib.mjs lockVerdict for why). Taken BEFORE
// Postgres starts, so the loser exits without touching the cluster, the live
// pointer, or the ports.
const lock = lockPath(cfg.dataDir);

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to someone else: alive for our
    // purposes. ESRCH is the only "gone".
    return err?.code === "EPERM";
  }
}

function acquireLock() {
  try {
    // wx is the atomic part: create-or-fail, so two supervisors starting in
    // the same instant cannot both believe they took it.
    writeFileSync(lock, String(process.pid), { flag: "wx" });
    return;
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }
  let recorded = NaN;
  try {
    recorded = Number.parseInt(readFileSync(lock, "utf8").trim(), 10);
  } catch {
    // unreadable counts as garbage, handled by the verdict below
  }
  const verdict = lockVerdict(recorded, process.pid, Number.isInteger(recorded) && pidAlive(recorded));
  if (verdict === "refuse") {
    log("another supervisor already owns this data directory; exiting", {
      dataDir: cfg.dataDir,
      ownerPid: recorded,
      lock,
    });
    console.error(
      `
A supervisor is already running for ${cfg.dataDir} (pid ${recorded}).
` +
        `Stop that one first, or delete ${lock} if you are certain it is dead.
`
    );
    process.exit(1);
  }
  if (verdict === "steal") log("taking over a stale lock", { stalePid: recorded });
  writeFileSync(lock, String(process.pid));
}

function releaseLock() {
  try {
    if (Number.parseInt(readFileSync(lock, "utf8").trim(), 10) === process.pid) unlinkSync(lock);
  } catch {
    // never block shutdown on the lock file
  }
}


/**
 * Shut the cluster down the way Postgres wants to be shut down.
 *
 * embedded-postgres's own `stop()` runs `taskkill /pid <postmaster> /f /t` on
 * Windows, which is not a shutdown at all — it is a kill, so every single stop
 * leaves the cluster replaying WAL on the next start ("database system was not
 * properly shut down; automatic recovery in progress", observed on the dev rig
 * 2026-08-23). Recovery is safe, but it is not free, and a hub that gets
 * stopped for every update should not pay it every time.
 *
 * `pg_ctl stop -m fast` is the ordinary answer: refuse new connections, roll
 * back open transactions, checkpoint, exit. pg_ctl ships in the same bin
 * directory as the postgres binary embedded-postgres already resolved.
 */
function stopPostgresGracefully() {
  let bin;
  try {
    // resolve() lands on the package's dist entry; the binaries live one level
    // up in native/bin.
    bin = dirname(dirname(requireFromRepo.resolve("@embedded-postgres/" + PG_PLATFORM_PKG)));
  } catch {
    return false;
  }
  const pgCtl = join(bin, "native", "bin", isWin ? "pg_ctl.exe" : "pg_ctl");
  if (!existsSync(pgCtl)) return false;
  // -w waits for it to finish; -t bounds that wait so a wedged cluster cannot
  // hang shutdown forever (the forced stop below is the fallback).
  const res = run(pgCtl, ["stop", "-D", pgDir, "-m", "fast", "-w", "-t", "30"]);
  if (!res.ok) log("pg_ctl stop did not complete; falling back to a forced stop", {
    detail: res.stderr || res.stdout,
  });
  return res.ok;
}

async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down", { sig });
  if (restartTimer) clearTimeout(restartTimer);
  await stopApp();
  const clean = stopPostgresGracefully();
  try {
    // Either finishes the job (when pg_ctl could not) or just releases the
    // handle. Bounded: once the postmaster has already exited, this library's
    // promise waits on an "exit" event that has been and gone.
    await Promise.race([pg.stop(), new Promise((r) => setTimeout(r, clean ? 2000 : 20000))]);
  } catch (err) {
    log("postgres stop failed", { error: String(err) });
  }
  log("postgres stopped", { clean });
  releaseLock();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

acquireLock();
await startPostgres();
const ptr = liveBuild();
if (ptr) {
  startApp(ptr);
} else {
  // No pull on first boot: a fresh clone is already current, and an origin
  // hiccup must not block the very first build.
  log("no live build yet; building the repo's current HEAD");
  await applyUpdate("first run", { pull: false });
  if (!liveBuild()) {
    log("first build failed; supervisor stays up (fix the repo, then touch the signal file)");
  }
}
// The interval timers are unref'd; the postgres + app children keep the
// process alive. A bare interval pins the event loop for the no-child window
// between a crash and its restart.
setInterval(() => {}, 60_000);
