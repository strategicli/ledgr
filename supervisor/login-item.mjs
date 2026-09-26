// Start with the computer on macOS and Linux (install plan step 8): a launchd
// user agent on a Mac, a systemd user unit on Linux. Per user, never sudo. The
// Windows equivalents (the Startup-folder shortcut, the scheduled task) stay in
// the supervisor; this is their twin, used by the supervisor (the app's "Start
// with the computer" box) and by `ledgr-ctl startup` alike, so the two cannot
// disagree about what is registered.
//
// Both entries run `ledgr-ctl boot`, never the supervisor itself: boot starts
// the supervisor of whichever build is serving, detached, with its logs, and
// is a no-op when one is already up (the same reason the Windows task does).
//
// The renderers and the reconcile rule are pure and checked by
// scripts/verify-installer.mts; register/query are the thin shell around them.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { STARTUP_TASK_NAME, nodeFor } from "./lib.mjs";
import { PACKAGE_INFO_FILE } from "./release.mjs";

// ── Names ────────────────────────────────────────────────────────────────────

/** "Ledgr app" → "ledgr-app"; a git install's "Ledgr Supervisor" → "ledgr-supervisor". */
export function loginItemSlug(name) {
  return String(name || STARTUP_TASK_NAME)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * `org.ledgr.app` for an installed copy, `org.ledgr.supervisor` for a git
 * install: the label supervisor/README.md always told git installs to use, so
 * one made by hand is replaced rather than joined by a second.
 */
export function launchAgentLabel(name) {
  return `org.ledgr.${loginItemSlug(name).replace(/^ledgr-/, "")}`;
}

/** `ledgr-app.service`, or `ledgr-supervisor.service` for a git install (as documented). */
export function systemdUnitName(name) {
  return `${loginItemSlug(name)}.service`;
}

/** Where this copy's entry lives, or null on a platform without one here (Windows). */
export function loginItemPaths(platform, home, name, env = {}) {
  if (platform === "darwin") {
    const label = launchAgentLabel(name);
    return { kind: "launchd", label, file: join(home, "Library", "LaunchAgents", `${label}.plist`) };
  }
  if (platform === "linux") {
    const unit = systemdUnitName(name);
    const dir = join(env.XDG_CONFIG_HOME || join(home, ".config"), "systemd", "user");
    return { kind: "systemd", unit, file: join(dir, unit), wants: join(dir, "default.target.wants", unit) };
  }
  return null;
}

/**
 * What the entry runs: the Node and ledgr-ctl of the folder Ledgr was installed
 * into (never a builds/<version> an update prunes), or, for a git install, the
 * Node running now and the ledgr-ctl beside it.
 */
export function loginItemCommand({ repoDir, here, execPath, exists }) {
  const stable = exists(join(repoDir, PACKAGE_INFO_FILE)) ? repoDir : null;
  return {
    node: nodeFor(stable, execPath, false, exists),
    ctl: stable ? join(stable, "supervisor", "ledgr-ctl.mjs") : join(here, "ledgr-ctl.mjs"),
  };
}

// ── Renderers (pure) ─────────────────────────────────────────────────────────

const xml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A launchd user agent: run `ledgr-ctl boot` once at sign-in. */
export function renderLaunchAgent({ label, node, ctl, configPath, path, log }) {
  const args = [node, ctl, "boot", `--config=${configPath}`].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Made by Ledgr: starts Ledgr when you sign in. Build > Updates > Start with the computer turns it off. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <!-- boot starts the service detached and exits; launchd must not end it. -->
  <key>AbandonProcessGroup</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

// systemd quoting: inside double quotes, backslash and quote are escaped, and
// `%` (a specifier) is doubled everywhere. `$` is a variable only in Exec lines.
const sdEnv = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
const sdExec = (s) => sdEnv(s).replace(/\$/g, "$$$$");

/**
 * A systemd user unit. `oneshot` + `RemainAfterExit` because boot starts the
 * service detached and exits; `KillMode=process` so a boot that gives up
 * waiting (a slow first start) never takes the still-starting service with it.
 * Stopping the unit (signing out, or `systemctl --user stop`) runs a clean
 * `ledgr-ctl stop`.
 */
export function renderSystemdUnit({ node, ctl, configPath, path }) {
  const cmd = (verb) => [node, ctl, verb, `--config=${configPath}`].map(sdExec).join(" ");
  return `# Made by Ledgr: starts Ledgr when you sign in. Build > Updates > Start with the computer turns it off.
[Unit]
Description=Ledgr

[Service]
Type=oneshot
RemainAfterExit=yes
KillMode=process
TimeoutStartSec=10min
TimeoutStopSec=90
Environment=${sdEnv(`PATH=${path}`)}
ExecStart=${cmd("boot")}
ExecStop=${cmd("stop")}

[Install]
WantedBy=default.target
`;
}

/** Is this label switched off in `launchctl print-disabled gui/<uid>` (System Settings → Login Items)? */
export function launchdDisabled(text, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`"${esc}"\\s*=>\\s*(disabled|true)\\b`).test(String(text ?? ""));
}

// ── Words ────────────────────────────────────────────────────────────────────

export const MAC_ALWAYS_CAVEAT =
  "A Mac only starts apps before anyone signs in with an administrator's help, so Ledgr starts when you sign in instead. " +
  "If this Mac must come back by itself after a power cut, turn on automatic login in System Settings → Users & Groups.";

export const MAC_BLOCKED_DETAIL =
  "macOS has Ledgr switched off in System Settings → General → Login Items & Extensions (under \"Allow in the Background\"). " +
  "Switch it back on there, or press Turn it on here.";

export function lingerCaveat(user) {
  return (
    "Ledgr starts when you sign in, but this computer did not let it also start before anyone signs in. " +
    `Run this once in a terminal to allow that: sudo loginctl enable-linger ${user}`
  );
}

// ── The truth, and keeping the record in step with it ───────────────────────

/**
 * The startup-state record to write so it matches what the computer actually
 * holds, or null when the record already does. The app's box reads only the
 * record, so a login item removed or switched off by hand must reach it.
 * A failed request that left nothing registered is left alone: its detail is
 * the useful part.
 */
export function reconcileStartupRecord(recorded, live) {
  if (!live) return null;
  const recordedOn = !!(recorded?.enabled && recorded.ok);
  if (live.blocked) {
    if (recorded?.enabled && !recorded.ok && recorded.detail === MAC_BLOCKED_DETAIL) return null;
    return { enabled: true, scope: "logon", ok: false, detail: MAC_BLOCKED_DETAIL };
  }
  if (live.registered) {
    if (recordedOn && recorded.scope === live.scope) return null;
    return { enabled: true, scope: live.scope, ok: true, caveat: recordedOn ? recorded.caveat : null };
  }
  if (!recordedOn) return null;
  return { enabled: false, scope: recorded.scope, ok: true };
}

// ── The shell ────────────────────────────────────────────────────────────────

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr || String(r.error ?? "")).trim() };
}

const uid = () => (typeof process.getuid === "function" ? process.getuid() : 0);

/** What this computer holds for this copy right now, or null on Windows. */
export function queryLoginItem({ name, platform = process.platform, home = homedir(), env = process.env }) {
  const p = loginItemPaths(platform, home, name, env);
  if (!p) return null;
  if (p.kind === "launchd") {
    if (!existsSync(p.file)) return { ...p, registered: false, blocked: false, scope: null };
    const blocked = launchdDisabled(sh("launchctl", ["print-disabled", `gui/${uid()}`]).out, p.label);
    return { ...p, registered: !blocked, blocked, scope: "logon" };
  }
  let linked = false;
  try {
    linked = !!lstatSync(p.wants);
  } catch {
    // not enabled
  }
  const registered = linked && existsSync(p.file);
  const linger = existsSync(join("/var/lib/systemd/linger", userInfo().username));
  return { ...p, registered, blocked: false, scope: registered ? (linger ? "always" : "logon") : null };
}

/**
 * Write (or remove) this copy's entry. Returns what to record: {ok, scope,
 * detail, caveat}. Never asks for a password; what needs one is said, with the
 * command, instead.
 */
export function registerLoginItem({ name, enabled, scope, node, ctl, configPath, dataDir, platform = process.platform, home = homedir(), env = process.env }) {
  const p = loginItemPaths(platform, home, name, env);
  if (!p) return { ok: false, scope, detail: "not a macOS or Linux computer" };
  const path = env.PATH || "/usr/local/bin:/usr/bin:/bin";
  try {
    if (p.kind === "launchd") {
      const target = `gui/${uid()}`;
      if (!enabled) {
        sh("launchctl", ["bootout", `${target}/${p.label}`]);
        rmSync(p.file, { force: true });
        return { ok: true, scope };
      }
      mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
      writeFileSync(p.file, renderLaunchAgent({ label: p.label, node, ctl, configPath, path, log: join(dataDir, "login-item.log") }), "utf8");
      // Load it now, not only at the next sign-in, and clear an earlier "off"
      // from Login Items: the owner just asked for it. RunAtLoad runs boot at
      // once, which does nothing when Ledgr is already up.
      sh("launchctl", ["bootout", `${target}/${p.label}`]);
      sh("launchctl", ["enable", `${target}/${p.label}`]);
      // A bootout finishes in the background, so an immediate bootstrap can
      // fail with "5: Input/output error"; give it a moment and try again.
      let loaded = sh("launchctl", ["bootstrap", target, p.file]);
      for (let i = 0; i < 3 && !loaded.ok; i += 1) {
        spawnSync("sleep", ["1"]);
        loaded = sh("launchctl", ["bootstrap", target, p.file]);
      }
      const caveat = scope === "always" ? MAC_ALWAYS_CAVEAT : null;
      return {
        ok: true,
        scope: "logon",
        caveat,
        note: loaded.ok ? null : `written; launchd will load it at the next sign-in (${loaded.err.split("\n")[0]})`,
      };
    }
    if (!enabled) {
      rmSync(p.wants, { force: true });
      rmSync(p.file, { force: true });
      sh("systemctl", ["--user", "daemon-reload"]);
      // Starting before sign-in (linger) belongs to the whole account, and other
      // services may rely on it, so turning Ledgr off leaves it as it is.
      return { ok: true, scope };
    }
    mkdirSync(join(p.file, "..", "default.target.wants"), { recursive: true });
    writeFileSync(p.file, renderSystemdUnit({ node, ctl, configPath, path }), "utf8");
    // What `systemctl --user enable` does for WantedBy=default.target, done
    // directly so it works even where no user session bus is running (SSH).
    rmSync(p.wants, { force: true });
    symlinkSync(p.file, p.wants);
    sh("systemctl", ["--user", "daemon-reload"]);
    if (scope !== "always") return { ok: true, scope: "logon" };
    const user = userInfo().username;
    const linger = sh("loginctl", ["--no-ask-password", "enable-linger", user]);
    if (linger.ok || existsSync(join("/var/lib/systemd/linger", user))) return { ok: true, scope: "always" };
    return { ok: true, scope: "logon", caveat: lingerCaveat(user) };
  } catch (err) {
    return { ok: false, scope, detail: String(err?.message ?? err) };
  }
}
