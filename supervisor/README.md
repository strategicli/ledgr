# Ledgr local-peer supervisor (LH2, ADR-206)

One long-running Node process that owns everything a local Ledgr peer needs:
embedded Postgres, the app (`next start`), and the update apply path. No
system Postgres install, no service wiring beyond registering this one
process to run at boot.

## Configure

```
cp supervisor/config.example.json supervisor/config.json   # gitignored
```

| Key | Meaning |
| --- | --- |
| `role` | `hub` or `spoke`. Informational for now; hub duties (crons, Funnel) land in phase 5. |
| `dataDir` | Where everything lives: `pg/` (the database cluster), `builds/` (app builds), `live.json` (which build serves), `update-requested` (the signal file). Outside the repo. |
| `repoDir` | The git clone the supervisor pulls and builds from. Defaults to the repo this file lives in. |
| `branch` | Branch to track (default `main`). |
| `appPort` / `dbPort` | The app and Postgres ports (defaults 3000 / 5433). |
| `ownerEmail` | Becomes `LEDGR_LOCAL_OWNER_EMAIL`: the no-login local owner identity (plan decision 5). Must match the owner's `users.email`. |
| `hubs` / `deviceToken` | Ordered hub URLs plus this device's sync token (minted on the hub). Both set arms the in-app sync loop; either missing leaves sync off. |
| `syncMode` | `full` (default) pushes and pulls. `pull-only` never sends this device's own changes to the hub — only receives. Threaded through as `LEDGR_SYNC_MODE`. See "Arming sync safely" below. |
| `update.mode` | `prompted` (default): updates apply only when the app's Update button writes the signal file. `auto`: the supervisor also polls git every `pollIntervalMs` and applies on its own. |
| `cadence` | Sync knobs, passed through as `LEDGR_SYNC_PUSH_DEBOUNCE_MS` / `LEDGR_SYNC_PULL_MS`. |
| `syncGuardrails.maxFirstPush` | This device's very first push (this process's lifetime) is held rather than sent if the pending oplog exceeds this count (default 500) — the guard against a bad restore or bug dumping the whole database at the hub as edits. Only the first push is gated; a busy device that's been syncing fine is never throttled. Threaded as `LEDGR_SYNC_MAX_FIRST_PUSH`. |
| `syncGuardrails.confirmLargePush` | Set `true` (after looking at what's pending) to release a held first push without raising the limit. Threaded as `LEDGR_SYNC_CONFIRM_LARGE_PUSH`. |
| `syncGuardrails.skewWarnMs` / `skewHoldMs` | Clock-skew thresholds (ms) against the hub's reported time. Past `skewWarnMs` (default 5000) the Sync section and pill turn amber but syncing continues; past `skewHoldMs` (default 60000) pushes are held — last-writer-wins can't be trusted at that much drift — while pulling keeps working. Threaded as `LEDGR_SYNC_SKEW_WARN_MS` / `LEDGR_SYNC_SKEW_HOLD_MS`. |
| `extraEnv` | Any additional env for the app (R2 keys, Graph secrets, machine tokens), passed through verbatim. |

### Arming sync safely

The first time a device syncs against your **production** hub, prove data
flows the right way before letting it push:

1. On the hub's `/build/updates` → Synced devices, **Add device** with the
   "Pull-only" checkbox on (the default for a new device). Paste the token
   into this device's `deviceToken`.
2. Start this device and confirm data arrives correctly — it can only pull,
   so nothing it does can touch the hub's data.
3. Once you're satisfied, flip it to full either from the hub (the device row's
   "Allow push" button) or by setting `"syncMode": "full"` here and
   restarting. The hub-side flip takes effect immediately, even if this
   device is offline or misconfigured — that's the point of doing it there.

## Run

```
npm run local:supervisor
```

First run: initdb, then a full build of the repo's current HEAD (npm ci +
`next build` + migrate), then the app serves on `appPort`. Ctrl+C stops the
app, then Postgres, in order.

First **data**: fill it before first use, either from the weekly backup —

```
npm run local:restore -- /path/to/ledgr-YYYY-MM-DD.dump
```

— or straight from the live database (fresher, no file to find; any Neon
connection string works, pooled or direct, and this path needs no extra
tools at all — it copies rows natively with the `pg` driver, since the
schema comes from running our own migrations rather than pg_dump):

```
npm run local:restore -- --from-url "postgresql://...neon.tech/ledgr"
```

(The backup-file form above still needs `pg_restore` on PATH; the embedded
binaries ship the server only. Stop the supervisor first, either way.) Both
forms clear the sync state that must not be cloned from the hub — the
oplog, peer registrations, and cursors always come out fresh, and the local
device identity is simply this peer's own (never the hub's) either way. If
this peer syncs against a hub, its first pull/push cycle reconciles
everything newer than the fill.

## Update flow and keep-last-good

"Update now" in the app (or the auto poll) writes `<dataDir>/update-requested`.
The supervisor then:

1. `git pull --ff-only` in `repoDir`.
2. Fresh checkout of the new commit into `builds/<sha>/` (a git worktree).
   The directory the running app serves from is never touched — required on
   Windows, where you cannot swap files out from under a running process.
3. `npm ci` in the new build only if `package-lock.json` changed; otherwise
   the live build's `node_modules` is copied.
4. `next build`, then `scripts/migrate.mjs` against the local database.
5. Only if **both** succeeded: stop the app, point `live.json` at the new
   build, start the app from it. Any failure at any step leaves the previous
   build serving, untouched, and removes the failed attempt.
6. Prune to the last 2 builds (live + one fallback).

`live.json` is a plain pointer file rather than a symlink/junction: it works
identically on every platform, needs no privileges, and the supervisor reads
it once at spawn.

## Set up a new machine: download `install.cmd` (LH4)

On Windows, the whole bring-up below collapses to one downloaded file:
**download `install.cmd` and double-click it.** (Windows won't run a `.ps1`
on double-click — it opens an editor instead — so `install.cmd` is the file
to actually download; it's a tiny wrapper that runs `install.ps1` and keeps
the window open so you can read the result. If `install.ps1` isn't sitting
next to it, it fetches that too.)

The PowerShell invocation still works directly, if you'd rather:

```
powershell -ExecutionPolicy Bypass -File install.ps1
```

It installs git, Node LTS, and the Postgres client tools via winget if
missing (the Postgres tools warn-and-continue rather than blocking, since
starting empty doesn't need them), clones the repo into
`%LOCALAPPDATA%\Ledgr\app` (override with `-InstallDir`), runs `npm ci`, and
hands off to the cross-platform wizard — `npm run local:setup` — which asks
hub-or-spoke, fills the initial data, writes `supervisor/config.json` (never
clobbering without `--force`), and offers the Task Scheduler registration.
Every prompt has a flag override (`node scripts/local-setup.mjs --help`), so
it also runs unattended. On macOS/Linux the wizard is the same; only the
bootstrap differs (`install.sh` is deferred to post-cutover — clone + `npm ci`
by hand, then `npm run local:setup`).

**Initial data, three ways** (the wizard's "Initial data" question):

- **Restore a backup file** — the fast path when you already have one.
  Download the newest `ledgr-*.dump` from OneDrive `/Ledgr/Backups/`, then
  point `--backup` at it (or answer the prompt with its path).
- **Pull from the live database** — fresher than the weekly backup, no
  hunting for a file, and **no extra tools needed at all**. Any Neon
  connection string works, the pooled one included, since this path copies
  rows natively with the `pg` driver the app already ships rather than
  shelling out to `pg_dump` (the schema comes from running our own
  migrations, not from a portable dump).
- **Start empty** — migrate + seed a fresh database; a syncing spoke then
  reconciles everything from the hub on its first pull (correct, but slower
  for a large dataset).

Only the restore-from-file path needs the Postgres client tools (`pg_restore`)
on PATH — `winget install PostgreSQL.PostgreSQL.18` on Windows,
`brew install libpq` on macOS. The wizard's data-fill step says so if it's
missing; the live pull needs nothing beyond `npm ci`.

## Windows bring-up checklist (manual fallback; also what install.ps1 does)

Run these on the always-on PC, in order:

1. **Install the tools** (PowerShell, admin not required for winget):
   - `winget install Git.Git`
   - `winget install OpenJS.NodeJS.LTS`
   - `winget install PostgreSQL.PostgreSQL.18` (client tools only needed for
     restoring from a backup FILE, via `pg_restore`; the live database pull
     needs none of this. The installer does NOT add itself to PATH — unlike
     Git and Node — so add its `bin` folder yourself if you go this route;
     `install.ps1` also finds and uses it automatically)
2. **Clone and install:**
   - `git clone https://github.com/strategicli/ledgr.git C:\ledgr`
   - `cd C:\ledgr && npm ci`
   - Watch: `npm ci` fetches the **win32-x64 embedded-postgres binaries**
     (`@embedded-postgres/windows-x64`); confirm the package landed.
3. **Configure:** copy `supervisor\config.example.json` to
   `supervisor\config.json`; set `dataDir` (e.g. `C:/ledgr-data`),
   `ownerEmail`, and (for a syncing spoke) `hubs` + `deviceToken` minted on
   the hub's Synced-devices section. (Steps 3-4 and 7 are the wizard's job:
   `npm run local:setup`.)
4. **Fill the data:** either download the newest `ledgr-*.dump` from OneDrive
   `/Ledgr/Backups/` and `npm run local:restore -- C:\path\to\ledgr-....dump`
   (watch: `pg_restore` must be on PATH and be the PG 17+ client — `pg_restore
   --version`), or pull straight from the live database — any connection
   string works, pooled included — with `npm run local:restore -- --from-url
   "..."` (no client tools needed for this path at all).
5. **First supervisor run, in a terminal** (not the service yet):
   `npm run local:supervisor`. Watch for:
   - **initdb succeeds** (embedded-postgres win32 binaries actually run;
     antivirus can quarantine `postgres.exe` — allowlist `dataDir` if so).
   - **The Windows Firewall prompt** for node.exe on the app port — allow on
     private networks, or nothing off-machine (Tailscale included) can reach it.
   - The app answering at `http://localhost:3000` and signing you in as the
     local owner with your real data.
6. **Prove keep-last-good on the PC:** press Update now (or create
   `update-requested` in `dataDir`) once a newer commit exists; then break a
   build deliberately (e.g. point `branch` at a known-bad commit) and confirm
   the old version keeps serving. This is the **file-locks** test: the swap
   must succeed while the old app is running (nothing writes into the serving
   directory, but Windows will surface any violation here, not on the Mac).
7. **Register at boot (Task Scheduler):**
   ```
   schtasks /Create /TN "Ledgr Supervisor" /SC ONSTART /RU "%USERNAME%" ^
     /TR "\"C:\Program Files\nodejs\node.exe\" C:\ledgr\supervisor\ledgr-supervisor.mjs C:\ledgr\supervisor\config.json"
   ```
   Then `schtasks /Run /TN "Ledgr Supervisor"` to start it without rebooting.
   Watch: the task runs whether or not you're logged in only if you set a
   stored credential (`/RP`); scheduled tasks get no firewall prompt, so do
   step 5 in a terminal first.
8. **Reboot once** and confirm the app comes back on its own.

Windows-specific unknowns to watch overall: file locks during the build swap
(step 6), the embedded-postgres win32 binaries under antivirus (step 5), and
the firewall prompt for the app port (step 5).

## Register at boot (macOS / Linux)

The wizard prints these rather than executing them (Windows is the only
platform where it offers to run the registration itself):

- **macOS (launchd):** `~/Library/LaunchAgents/org.ledgr.supervisor.plist`
  with `RunAtLoad` true and `ProgramArguments` =
  `[node, <repo>/supervisor/ledgr-supervisor.mjs, <repo>/supervisor/config.json]`,
  then `launchctl load` it.
- **Linux (systemd user unit):**
  `~/.config/systemd/user/ledgr-supervisor.service` with
  `ExecStart=node <repo>/supervisor/ledgr-supervisor.mjs <repo>/supervisor/config.json`
  and `Restart=always`, then `systemctl --user enable --now ledgr-supervisor`.
