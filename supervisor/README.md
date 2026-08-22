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
| `update.mode` | `prompted` (default): updates apply only when the app's Update button writes the signal file. `auto`: the supervisor also polls git every `pollIntervalMs` and applies on its own. |
| `cadence` | Sync knobs, passed through as `LEDGR_SYNC_PUSH_DEBOUNCE_MS` / `LEDGR_SYNC_PULL_MS`. |
| `extraEnv` | Any additional env for the app (R2 keys, Graph secrets, machine tokens), passed through verbatim. |

## Run

```
npm run local:supervisor
```

First run: initdb, then a full build of the repo's current HEAD (npm ci +
`next build` + migrate), then the app serves on `appPort`. Ctrl+C stops the
app, then Postgres, in order.

First **data**: restore the weekly backup before first use —

```
npm run local:restore -- /path/to/ledgr-YYYY-MM-DD.dump
```

(Needs `pg_restore` on PATH; the embedded binaries ship the server only.
Stop the supervisor first.) The restore clears the sync state that must not
be cloned from the hub — the oplog, the device identity, peer registrations,
and cursors — so the peer starts as a fresh device. If it syncs against a
hub, its first pull/push cycle reconciles everything newer than the backup.

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

## Set up a new machine: run `install.ps1` (LH4)

On Windows, the whole bring-up below collapses to one downloaded file:

```
powershell -ExecutionPolicy Bypass -File install.ps1
```

It installs git and Node LTS via winget if missing, clones the repo into
`%LOCALAPPDATA%\Ledgr\app` (override with `-InstallDir`), runs `npm ci`, and
hands off to the cross-platform wizard — `npm run local:setup` — which asks
hub-or-spoke, restores a backup or starts empty (migrate + seed), writes
`supervisor/config.json` (never clobbering without `--force`), and offers the
Task Scheduler registration. Every prompt has a flag override
(`node scripts/local-setup.mjs --help`), so it also runs unattended. On
macOS/Linux the wizard is the same; only the bootstrap differs (`install.sh`
is deferred to post-cutover — clone + `npm ci` by hand, then
`npm run local:setup`). Restoring a backup still needs `pg_restore` on PATH
(`winget install PostgreSQL.PostgreSQL.18`); the wizard's restore path says so
if it's missing.

## Windows bring-up checklist (manual fallback; also what install.ps1 does)

Run these on the always-on PC, in order:

1. **Install the tools** (PowerShell, admin not required for winget):
   - `winget install Git.Git`
   - `winget install OpenJS.NodeJS.LTS`
   - `winget install PostgreSQL.PostgreSQL.18` (client tools only needed for
     `pg_restore`; add its `bin` to PATH if the installer didn't)
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
4. **Restore the backup:** download the newest `ledgr-*.dump` from OneDrive
   `/Ledgr/Backups/`, then `npm run local:restore -- C:\path\to\ledgr-....dump`.
   Watch: `pg_restore` must be the PG 17+ client (`pg_restore --version`).
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
