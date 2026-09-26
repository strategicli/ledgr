#!/usr/bin/env node
// The Windows installer's helper (install plan step 7).
//
// The Inno Setup script (scripts/ledgr-setup.iss) copies the package and then
// calls this, with the package's own Node, for everything that needs a
// decision. Keeping the decisions here means they are JavaScript with a check
// (scripts/verify-installer.mts) rather than Pascal nobody can test.
//
//   node supervisor/installer.mjs prepare --app <dir> --data <dir> --channel main
//   node supervisor/installer.mjs start   --data <dir>
//   node supervisor/installer.mjs open    --data <dir> [--setup]
//   node supervisor/installer.mjs stop    --app <dir> --data <dir>
//
// It never touches another Ledgr on the machine. A git install (Brandon's hub:
// the "Ledgr Supervisor" task, its own ports and data folder) is detected only
// so this one keeps clear of its ports; its task, config, data and processes
// are read, never written, stopped or re-registered.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  STARTUP_TASK_NAME,
  livePointerPath,
  parseLivePointer,
  parseStartupState,
  schtasksQueryArgs,
  serializeStartupRequest,
  startupShortcutPath,
  startupSignalPath,
  startupStatePath,
  trayLaunchArgs,
} from "./lib.mjs";
import { compareVersions, parsePackageInfo, PACKAGE_INFO_FILE } from "./release.mjs";

/** This copy's names. Never "Ledgr Supervisor" or the git tray's "Ledgr.lnk". */
export const INSTALLED_STARTUP_NAME = "Ledgr app";
/** The ports a git install uses when its config names none. */
export const DEFAULT_PORTS = { appPort: 3000, dbPort: 5433 };

// ── Pure: what is already on this machine ────────────────────────────────────

/**
 * Every TCP port something listens on, from `netstat -ano`. A listening socket
 * is the one whose remote end is all zeros, which holds in every Windows
 * language (the "LISTENING" word itself is translated).
 */
export function parseListeningPorts(text) {
  const ports = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+)\s+(\S+)/i.exec(line);
    if (!m || !/^(0\.0\.0\.0|\[::\]|\*):0$/.test(m[2])) continue;
    const port = Number(m[1].slice(m[1].lastIndexOf(":") + 1));
    if (Number.isInteger(port) && port > 0) ports.add(port);
  }
  return ports;
}

/**
 * The ranges Windows keeps for itself (Hyper-V and WSL reserve blocks), from
 * `netsh int ipv4 show excludedportrange protocol=tcp`. Nothing can listen
 * inside one, so a port there is as taken as a busy one.
 */
export function parseExcludedRanges(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\b/.exec(line);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

/** The config a running Ledgr process or a scheduled task names, or null. */
export function configPathFromCommandLine(cmdline) {
  const s = String(cmdline ?? "");
  const flag = /--config=(?:"([^"]+)"|(\S+))/.exec(s) ?? /-ConfigPath\s+(?:"([^"]+)"|(\S+))/i.exec(s);
  if (flag) return flag[1] ?? flag[2];
  const sup = /(?:"([^"]*ledgr-supervisor\.mjs)"|([^"\s]*ledgr-supervisor\.mjs))(?:\s+(?:"([^"]+)"|(\S+)))?/i.exec(s);
  if (!sup) return null;
  const arg = sup[3] ?? sup[4];
  if (arg) return arg;
  // No argument: the supervisor reads config.json beside itself.
  const script = sup[1] ?? sup[2];
  const cut = Math.max(script.lastIndexOf("\\"), script.lastIndexOf("/"));
  return cut < 0 ? "config.json" : script.slice(0, cut + 1) + "config.json";
}

/** Is this a Ledgr supervisor, control script or tray icon? */
export function isLedgrCommandLine(cmdline) {
  return /ledgr-(supervisor|ctl)\.mjs|ledgr-tray\.ps1/i.test(String(cmdline ?? ""));
}

/** The ports a Ledgr config claims (a git install's defaults when it names none). */
export function portsOfConfig(raw) {
  const n = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { appPort: n(raw?.appPort, DEFAULT_PORTS.appPort), dbPort: n(raw?.dbPort, DEFAULT_PORTS.dbPort) };
}

/**
 * Choose this copy's app and database ports: the git defaults when nothing
 * else could want them, otherwise the first pair, stepping by 10, where
 * neither port is listening, claimed by another Ledgr, or reserved by
 * Windows. A snapshot opened for browsing uses dbPort + 1000, so that one must
 * be free of the same things too.
 *
 * @param {{listening?: Set<number>, claimed?: Set<number>, excluded?: [number, number][], otherLedgr?: boolean}} o
 */
export function pickPorts({ listening = new Set(), claimed = new Set(), excluded = [], otherLedgr = false }) {
  const taken = (p) => listening.has(p) || claimed.has(p) || excluded.some(([a, b]) => p >= a && p <= b);
  for (let i = otherLedgr ? 1 : 0; i < 200; i += 1) {
    const appPort = DEFAULT_PORTS.appPort + 10 * i;
    const dbPort = DEFAULT_PORTS.dbPort + 10 * i;
    if (!taken(appPort) && !taken(dbPort) && !taken(dbPort + 1000)) return { appPort, dbPort };
  }
  throw new Error("could not find two free ports between 3000 and 7433");
}

/** The config the installer writes for a fresh install. The service fills in the rest. */
export function installConfig({ app, data, channel, appPort, dbPort }) {
  return {
    role: "hub",
    dataDir: data,
    repoDir: app,
    branch: channel || "main",
    appPort,
    dbPort,
    // A stand-in until the setup page makes the real owner (ADR-275): an
    // install with one owner resolves to that row whatever this says.
    ownerEmail: "owner@localhost",
    startupName: INSTALLED_STARTUP_NAME,
  };
}

/**
 * On an upgrade, what to do with live.json once the new package is in place.
 *
 *   "keep"  it points at a downloaded build (builds/<version>) that is at least
 *           as new as the package just installed: keep serving it.
 *   "reset" it points into the install folder, whose files were just replaced
 *           (so the recorded version is stale and the new migrations have not
 *           run), or at an older download. Removing the pointer makes the next
 *           start adopt the installed package: migrate, then serve it.
 *   "none"  there is no pointer; the next start adopts the package anyway.
 */
export function upgradeLiveAction({ live, installRoot, installedVersion, sep = "\\" }) {
  if (!live?.dir) return "none";
  const norm = (p) => String(p).replaceAll("/", sep).replace(/[\\/]+$/, "").toLowerCase();
  const root = norm(installRoot);
  const dir = norm(live.dir);
  if (dir === root || dir.startsWith(root + sep)) return "reset";
  const cmp = compareVersions(live.version ?? "", installedVersion ?? "");
  return cmp !== null && cmp >= 0 ? "keep" : "reset";
}

/**
 * Is this process part of THIS install, so uninstalling or upgrading may end
 * it? Only when its program lives in the install folder, in this install's
 * downloaded builds or its Tailscale helper folder, or it is the tray icon run
 * from the install folder. A process of any other Ledgr lives elsewhere and
 * never matches, and neither does the uninstaller itself.
 */
export function isOwnProcess({ exe, cmdline }, appDir, dataDir) {
  const low = (p) => String(p ?? "").replaceAll("/", "\\").toLowerCase().replace(/\\+$/, "");
  const app = low(appDir) + "\\";
  const inside = [app, low(dataDir) + "\\builds\\", low(dataDir) + "\\tailscale\\bin\\"];
  const e = low(exe);
  if (e && /\\unins[^\\]*$/.test(e)) return false;
  if (e && inside.some((dir) => e.startsWith(dir))) return true;
  return low(cmdline).includes(`${app}supervisor\\ledgr-tray.ps1`);
}

// ── The shell half ───────────────────────────────────────────────────────────

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function processes() {
  const r = sh("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
  ]);
  try {
    const list = JSON.parse(r.out || "[]");
    return (Array.isArray(list) ? list : [list]).map((p) => ({ pid: p.ProcessId, exe: p.ExecutablePath, cmdline: p.CommandLine }));
  } catch {
    return [];
  }
}

/** Every other Ledgr this machine shows: its scheduled task and running processes. */
function otherLedgrs(ownConfig) {
  const found = [];
  const task = sh("schtasks", schtasksQueryArgs(STARTUP_TASK_NAME));
  if (task.ok) found.push({ via: `the scheduled task "${STARTUP_TASK_NAME}"`, config: configPathFromCommandLine(task.out) });
  for (const p of processes()) {
    if (p.pid === process.pid || !isLedgrCommandLine(p.cmdline)) continue;
    found.push({ via: `a running process (pid ${p.pid})`, config: configPathFromCommandLine(p.cmdline), cmdline: p.cmdline });
  }
  return found.filter((f) => !f.config || resolve(f.config).toLowerCase() !== ownConfig.toLowerCase());
}

function args() {
  const a = process.argv.slice(3);
  const val = (k) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : null;
  };
  return { app: val("app"), data: val("data"), channel: val("channel"), setup: a.includes("--setup") };
}

function logTo(data, msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    appendFileSync(join(data, "install.log"), line + "\n");
  } catch {
    // the console line is enough
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const nodeExe = process.execPath;
const ctl = join(here, "ledgr-ctl.mjs");
const ctlRun = (verb, config) => spawnSync(nodeExe, [ctl, verb, `--config=${config}`], { stdio: "inherit", windowsHide: true }).status ?? 1;

async function answers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD", signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

function prepare({ app, data, channel }) {
  if (!app || !data) throw new Error("prepare needs --app and --data");
  mkdirSync(data, { recursive: true });
  const config = join(data, "config.json");
  if (existsSync(config)) {
    // An upgrade (or a reinstall over kept data): the config is the owner's,
    // untouched. Only the live pointer may need resetting (see upgradeLiveAction).
    const livePath = livePointerPath(data);
    const live = existsSync(livePath) ? parseLivePointer(readFileSync(livePath, "utf8")) : null;
    const info = parsePackageInfo(readFileSync(join(app, PACKAGE_INFO_FILE), "utf8"));
    const action = upgradeLiveAction({ live, installRoot: app, installedVersion: info?.version });
    if (action === "reset") unlinkSync(livePath);
    // Installing again over data an uninstall kept: the uninstaller removed the
    // start-at-sign-in shortcut, so ask for it back, unless the owner had
    // turned starting with the computer off.
    let st = null;
    try {
      st = parseStartupState(readFileSync(startupStatePath(data), "utf8"));
    } catch {
      // no record: the default is on
    }
    const name = JSON.parse(readFileSync(config, "utf8")).startupName || INSTALLED_STARTUP_NAME;
    if ((st?.enabled ?? true) && !existsSync(startupShortcutPath(process.env.APPDATA ?? "", name))) {
      writeFileSync(startupSignalPath(data), serializeStartupRequest(true, st?.scope ?? "logon"), "utf8");
    }
    logTo(data, `upgrade to ${info?.version ?? "?"}: kept ${config}; serving pointer ${action}`);
    return;
  }
  const others = otherLedgrs(resolve(config));
  const claimed = new Set();
  for (const o of others) {
    let ports = DEFAULT_PORTS;
    try {
      if (o.config) ports = portsOfConfig(JSON.parse(readFileSync(o.config, "utf8")));
    } catch {
      // unreadable: assume the defaults, which otherLedgr below skips anyway
    }
    const tray = /-AppPort\s+(\d+)[\s\S]*?-DbPort\s+(\d+)/i.exec(o.cmdline ?? "");
    if (tray) ports = { appPort: Number(tray[1]), dbPort: Number(tray[2]) };
    claimed.add(ports.appPort).add(ports.dbPort).add(ports.dbPort + 1000);
    logTo(data, `another Ledgr found through ${o.via}${o.config ? ` (config ${o.config})` : ""}; keeping clear of ports ${ports.appPort} and ${ports.dbPort}`);
  }
  const netstat = sh("netstat", ["-ano"]).out;
  const excluded = [
    ...parseExcludedRanges(sh("netsh", ["int", "ipv4", "show", "excludedportrange", "protocol=tcp"]).out),
    ...parseExcludedRanges(sh("netsh", ["int", "ipv6", "show", "excludedportrange", "protocol=tcp"]).out),
  ];
  const ports = pickPorts({ listening: parseListeningPorts(netstat), claimed, excluded, otherLedgr: others.length > 0 });
  writeFileSync(config, JSON.stringify(installConfig({ app, data, channel, ...ports }), null, 2) + "\n", "utf8");
  // The service makes the start-at-sign-in shortcut on its first start, the
  // same way the app's "Start with the computer" box asks it to, so the box
  // shows the truth and turning it off really turns it off.
  writeFileSync(startupSignalPath(data), serializeStartupRequest(true, "logon"), "utf8");
  logTo(data, `fresh install: app port ${ports.appPort}, database port ${ports.dbPort}, channel ${channel || "main"}`);
}

async function start({ data }) {
  const config = join(data, "config.json");
  const { appPort } = portsOfConfig(JSON.parse(readFileSync(config, "utf8")));
  ctlRun("boot", config);
  // The tray icon for this session (at later sign-ins the Startup shortcut runs it).
  const argList = trayLaunchArgs({ root, nodePath: nodeExe, configPath: config })
    .map((a) => `'${(/\s/.test(a) ? `"${a}"` : a).replace(/'/g, "''")}'`)
    .join(",");
  sh("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath 'powershell.exe' -ArgumentList @(${argList}) -WindowStyle Hidden`]);
  // A first start creates the database and runs every migration; give it time.
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (await answers(appPort)) {
      logTo(data, `serving on http://localhost:${appPort}/`);
      return 0;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  logTo(data, `not answering on ${appPort} after 5 minutes; see supervisor.log in ${data}`);
  return 1;
}

function stop({ app, data }) {
  const config = join(data, "config.json");
  if (existsSync(config)) ctlRun("stop", config);
  // Anything of THIS install still running (the tray icon, or a process a
  // clean stop could not end) is ended, so its files can be replaced or removed.
  for (const p of processes()) {
    if (p.pid !== process.pid && isOwnProcess(p, app, data)) {
      try {
        process.kill(p.pid);
      } catch {
        // already gone
      }
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const verb = process.argv[2];
  const a = args();
  try {
    if (verb === "prepare") prepare(a);
    else if (verb === "start") process.exitCode = await start(a);
    else if (verb === "open") process.exitCode = ctlRun(a.setup ? "setup" : "open", join(a.data, "config.json"));
    else if (verb === "stop") process.exitCode = stop(a);
    else {
      console.error("usage: installer.mjs prepare|start|open|stop --app <dir> --data <dir> [--channel <branch>] [--setup]");
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(String(err?.stack ?? err));
    if (a.data) logTo(a.data, `${verb} FAILED: ${String(err?.message ?? err)}`);
    process.exitCode = 1;
  }
}
