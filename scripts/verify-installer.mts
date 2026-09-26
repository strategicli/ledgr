// Verification for the installers' decisions: Windows (install plan step 7),
// and Mac/Linux (step 8, section 7 below).
//
// Pure: no network, no database, no child processes. What has to hold:
//   1. Busy ports are read from netstat in any Windows language, and the
//      ranges Windows reserves for itself count as busy.
//   2. Ports: the git defaults only when nothing else could want them;
//      otherwise the first free pair, never one another Ledgr claims.
//   3. Another Ledgr is found through its scheduled task or its processes,
//      and its config is read from the command line.
//   4. An upgrade re-adopts the installed package unless a newer download is
//      serving; uninstall ends only THIS install's processes.
//   5. This copy's names never collide with a git install's ("Ledgr
//      Supervisor", the tray's "Ledgr.lnk"), and a git install keeps its old
//      task name exactly.
//   6. The Inno Setup script agrees: no admin prompt, data outside the program
//      folder, and an upgrade deletes only program folders.
//
// Run: npx tsx scripts/verify-installer.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PORTS,
  INSTALLED_STARTUP_NAME,
  configPathFromCommandLine,
  installConfig,
  isLedgrCommandLine,
  isOwnProcess,
  parseExcludedRanges,
  parseListeningPorts,
  pickPorts,
  portsOfConfig,
  upgradeLiveAction,
} from "../supervisor/installer.mjs";
import {
  STARTUP_TASK_NAME,
  normalizeConfig,
  schtasksCreateArgs,
  schtasksDeleteArgs,
  schtasksQueryArgs,
  startupShortcutPath,
  startupTaskNameOf,
  trayLaunchArgs,
} from "../supervisor/lib.mjs";
import { LAUNCHERS, launcherPaths, parsePsList, renderDesktopEntry, renderMacLauncher } from "../supervisor/installer.mjs";
import {
  launchAgentLabel,
  launchdDisabled,
  loginItemCommand,
  loginItemPaths,
  reconcileStartupRecord,
  renderLaunchAgent,
  renderSystemdUnit,
  systemdUnitName,
} from "../supervisor/login-item.mjs";
import { archiveName, manifestFileFor, parseManifest, platformKey, renderInstallScript } from "../supervisor/release.mjs";

// One release with every platform's archive, as the package workflow publishes it.
const MANIFEST = {
  schema: 1,
  version: "20261001.000000",
  commit: "a".repeat(40),
  channel: "main",
  repo: "strategicli/ledgr",
  files: ["windows-x64", "macos-arm64", "macos-x64", "linux-x64"].map((platform, i) => ({
    name: archiveName("20261001.000000", platform),
    platform,
    sha256: String(i + 1).repeat(64),
    size: 100 + i,
  })),
};

let checks = 0;
function ok(what: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`  ✓ ${what}`);
}

console.log("1. What is listening");
const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       2228
  TCP    0.0.0.0:3000           0.0.0.0:0              ABHÖREN         18880
  TCP    127.0.0.1:5433         0.0.0.0:0              LISTENING       7880
  TCP    127.0.0.1:52000        127.0.0.1:5433         ESTABLISHED     1234
  TCP    [::]:3002              [::]:0                 LISTENING       18860
  TCP    [::1]:6433             [::]:0                 LISTENING       7880
  UDP    0.0.0.0:3010           *:*                                    999
`;
ok("listening sockets are found whatever the State column says", () => {
  assert.deepEqual([...parseListeningPorts(NETSTAT)].sort((a, b) => a - b), [135, 3000, 3002, 5433, 6433]);
});
ok("an established connection's local port and UDP are not listeners", () => {
  const p = parseListeningPorts(NETSTAT);
  assert.equal(p.has(52000), false);
  assert.equal(p.has(3010), false);
});
ok("Windows' reserved ranges are read", () => {
  const text = `Protocol tcp Port Exclusion Ranges\n\nStart Port    End Port\n----------    --------\n      2869        2869\n     50000       50059     *\n\n* - Administered port exclusions.\n`;
  assert.deepEqual(parseExcludedRanges(text), [
    [2869, 2869],
    [50000, 50059],
  ]);
});

console.log("2. Choosing ports");
ok("a machine with nothing on it gets the git defaults", () => {
  assert.deepEqual(pickPorts({}), DEFAULT_PORTS);
});
ok("another Ledgr means never the defaults, even when they look free right now", () => {
  // Brandon's hub may simply be stopped while this installs.
  assert.deepEqual(pickPorts({ otherLedgr: true }), { appPort: 3010, dbPort: 5443 });
});
ok("a busy app or database port moves both along", () => {
  assert.deepEqual(pickPorts({ listening: new Set([3000]) }), { appPort: 3010, dbPort: 5443 });
  assert.deepEqual(pickPorts({ listening: new Set([5433, 3010]) }), { appPort: 3020, dbPort: 5453 });
});
ok("a port another Ledgr's config claims is taken even when nothing listens", () => {
  assert.deepEqual(pickPorts({ claimed: new Set([3010, 5443]), otherLedgr: true }), { appPort: 3020, dbPort: 5453 });
});
ok("a Windows-reserved range and the snapshot browser's port (db + 1000) are avoided", () => {
  assert.deepEqual(pickPorts({ excluded: [[5430, 5445]] }), { appPort: 3020, dbPort: 5453 });
  assert.deepEqual(pickPorts({ listening: new Set([6433]) }), { appPort: 3010, dbPort: 5443 });
});
ok("a config with no ports claims the git defaults", () => {
  assert.deepEqual(portsOfConfig({}), DEFAULT_PORTS);
  assert.deepEqual(portsOfConfig({ appPort: 3100, dbPort: 5533 }), { appPort: 3100, dbPort: 5533 });
});

console.log("3. Finding another Ledgr");
ok("the git hub's scheduled task names its config", () => {
  const task = `Folder: \\\nTaskName:      \\Ledgr Supervisor\nTask To Run:                          "C:\\dev\\node\\node.exe" "C:\\dev\\ledgr\\supervisor\\ledgr-ctl.mjs" boot \n--config="C:\\dev\\ledgr\\supervisor\\config.json"\nSchedule Type: At system start up`;
  assert.equal(configPathFromCommandLine(task), "C:\\dev\\ledgr\\supervisor\\config.json");
});
ok("so do its tray icon and a supervisor started by hand", () => {
  const tray = `"powershell.exe" -NoProfile -File C:\\dev\\ledgr\\supervisor\\ledgr-tray.ps1 -NodePath C:\\dev\\node\\node.exe -CtlScript C:\\dev\\ledgr\\supervisor\\ledgr-ctl.mjs -ConfigPath C:\\dev\\ledgr\\supervisor\\config.json -AppPort 3000`;
  assert.equal(configPathFromCommandLine(tray), "C:\\dev\\ledgr\\supervisor\\config.json");
  assert.equal(configPathFromCommandLine(`node "C:\\x y\\supervisor\\ledgr-supervisor.mjs" "C:\\data dir\\config.json"`), "C:\\data dir\\config.json");
  assert.equal(configPathFromCommandLine(`node C:\\ledgr\\supervisor\\ledgr-supervisor.mjs`), "C:\\ledgr\\supervisor\\config.json");
});
ok("unrelated processes are not Ledgr", () => {
  assert.equal(isLedgrCommandLine(`node C:\\npm\\npx-cli.js -y @softeria/ms-365-mcp-server`), false);
  assert.equal(configPathFromCommandLine(`node server.js`), null);
  assert.equal(isLedgrCommandLine(`powershell -File C:\\dev\\ledgr\\supervisor\\ledgr-tray.ps1`), true);
});

console.log("4. Upgrading and uninstalling");
const APP = "C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\Ledgr";
const DATA = "C:\\Users\\Jane Doe\\AppData\\Local\\LedgrData";
ok("a pointer into the replaced install folder is reset, so the new migrations run", () => {
  assert.equal(upgradeLiveAction({ live: { dir: `${APP}\\app`, version: "20260926.003445" }, installRoot: APP, installedVersion: "20261001.000000" }), "reset");
  assert.equal(upgradeLiveAction({ live: { dir: "c:/users/jane doe/appdata/local/programs/ledgr/app" }, installRoot: APP, installedVersion: "20261001.000000" }), "reset");
});
ok("a newer (or equal) downloaded build keeps serving; an older one is replaced", () => {
  const dl = (version: string) => ({ dir: `${DATA}\\builds\\${version}\\app`, version });
  assert.equal(upgradeLiveAction({ live: dl("20261002.000000"), installRoot: APP, installedVersion: "20261001.000000" }), "keep");
  assert.equal(upgradeLiveAction({ live: dl("20261001.000000"), installRoot: APP, installedVersion: "20261001.000000" }), "keep");
  assert.equal(upgradeLiveAction({ live: dl("20260930.000000"), installRoot: APP, installedVersion: "20261001.000000" }), "reset");
  assert.equal(upgradeLiveAction({ live: null, installRoot: APP, installedVersion: "20261001.000000" }), "none");
});
ok("only this install's processes are ever ended", () => {
  assert.equal(isOwnProcess({ exe: `${APP}\\node\\node.exe`, cmdline: "" }, APP, DATA), true);
  assert.equal(isOwnProcess({ exe: `${DATA}\\builds\\20261002.000000\\node\\node.exe`, cmdline: "" }, APP, DATA), true);
  assert.equal(isOwnProcess({ exe: `${APP}\\node_modules\\@embedded-postgres\\windows-x64\\native\\bin\\postgres.exe`, cmdline: "" }, APP, DATA), true);
  assert.equal(isOwnProcess({ exe: "C:\\Windows\\powershell.exe", cmdline: `powershell -File "${APP}\\supervisor\\ledgr-tray.ps1"` }, APP, DATA), true);
  // Brandon's git hub, and its tray: a different folder, never touched.
  assert.equal(isOwnProcess({ exe: "C:\\dev\\node\\node.exe", cmdline: "C:\\dev\\ledgr\\supervisor\\ledgr-supervisor.mjs" }, APP, DATA), false);
  assert.equal(isOwnProcess({ exe: "C:\\Windows\\powershell.exe", cmdline: "-File C:\\dev\\ledgr\\supervisor\\ledgr-tray.ps1" }, APP, DATA), false);
  // Nor the uninstaller itself, nor a folder that merely starts the same way.
  assert.equal(isOwnProcess({ exe: `${APP}\\unins000.exe`, cmdline: "" }, APP, DATA), false);
  assert.equal(isOwnProcess({ exe: `${APP}2\\node\\node.exe`, cmdline: "" }, APP, DATA), false);
});

console.log("5. Names");
ok("this copy's names are its own", () => {
  assert.notEqual(INSTALLED_STARTUP_NAME, STARTUP_TASK_NAME);
  assert.notEqual(`${INSTALLED_STARTUP_NAME}.lnk`, "Ledgr.lnk");
  const cfg = normalizeConfig(installConfig({ app: APP, data: DATA, channel: "main", appPort: 3010, dbPort: 5443 }), DATA);
  assert.equal(startupTaskNameOf(cfg), INSTALLED_STARTUP_NAME);
  // (repoDir/dataDir are Windows paths, which only resolve as absolute on Windows; CI runs Linux.)
  assert.equal(cfg.branch, "main");
  assert.equal(cfg.appPort, 3010);
  assert.ok(schtasksCreateArgs({ username: "j", nodePath: "n", supervisorScript: "s", configPath: "c", taskName: startupTaskNameOf(cfg) }).includes(INSTALLED_STARTUP_NAME));
  assert.match(startupShortcutPath("C:\\AppData\\Roaming", INSTALLED_STARTUP_NAME), /[\\/]Startup[\\/]Ledgr app\.lnk$/);
});
ok("a git install keeps the task name it always had", () => {
  const cfg = normalizeConfig({ dataDir: "C:/ledgr-data", ownerEmail: "a@b.c" }, "C:/ledgr/supervisor");
  assert.equal(cfg.startupName, null);
  assert.equal(startupTaskNameOf(cfg), "Ledgr Supervisor");
  assert.deepEqual(schtasksDeleteArgs(), ["/Delete", "/TN", "Ledgr Supervisor", "/F"]);
  assert.equal(schtasksQueryArgs()[2], "Ledgr Supervisor");
  assert.equal(schtasksCreateArgs({ username: "j", nodePath: "n", supervisorScript: "s", configPath: "c" })[2], "Ledgr Supervisor");
});
ok("the startup shortcut runs the tray from the install folder, starting Ledgr only when asked", () => {
  const a = trayLaunchArgs({ root: APP, nodePath: `${APP}\\node\\node.exe`, configPath: `${DATA}\\config.json`, boot: true });
  assert.ok(a.includes(`${APP}\\supervisor\\ledgr-tray.ps1`) && a.includes(`${APP}\\supervisor\\ledgr-ctl.mjs`));
  assert.equal(a.at(-1), "-Boot");
  assert.equal(trayLaunchArgs({ root: APP, nodePath: "n", configPath: "c" }).includes("-Boot"), false);
});

console.log("6. The Inno Setup script");
const iss = readFileSync("scripts/ledgr-setup.iss", "utf8");
ok("per user, no Administrator prompt", () => {
  assert.match(iss, /^PrivilegesRequired=lowest\r?$/m);
  assert.match(iss, /^DefaultDirName=\{autopf\}\\Ledgr\r?$/m);
});
ok("its startup name is the helper's, and it never names the git hub's task", () => {
  assert.ok(iss.includes(`#define StartupName "${INSTALLED_STARTUP_NAME}"`));
  assert.equal(iss.includes(`/TN "${STARTUP_TASK_NAME}"`), false);
  assert.equal(/Name:\s*"\{userstartup\}\\Ledgr\.lnk"/.test(iss), false);
});
ok("the data folder is outside the program folder, and an upgrade deletes only program folders", () => {
  assert.ok(iss.includes("ExpandConstant('{localappdata}\\LedgrData')"));
  const deletes = [...iss.matchAll(/^Type: filesandordirs; Name: "([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(deletes.length >= 8);
  for (const d of deletes) assert.ok(d === "{app}" || d.startsWith("{app}\\"), `${d} is outside the program folder`);
  assert.equal(/LedgrData/.test(iss.slice(iss.indexOf("[InstallDelete]"), iss.indexOf("[Files]"))), false);
});
ok("data is deleted only after the unticked box AND a second yes", () => {
  assert.ok(iss.includes("Box.Checked := False;"));
  assert.ok(iss.includes("DeleteData := Result and Box.Checked;"));
  assert.ok(iss.includes("MB_YESNO or MB_DEFBUTTON2) = IDYES"));
  assert.equal((iss.match(/DelTree\(/g) ?? []).length, 1);
  assert.match(iss, /if DeleteData then\s+DelTree\(DataDir\(''\)/);
});

console.log("7. Mac and Linux: which package, the install script, start at sign-in");
ok("each computer picks its own archive from a release's manifest", () => {
  assert.equal(platformKey("darwin", "arm64"), "macos-arm64");
  assert.equal(platformKey("darwin", "x64"), "macos-x64");
  assert.equal(platformKey("linux", "x64"), "linux-x64");
  assert.equal(platformKey("linux", "ia32"), null);
  assert.equal(archiveName("20261001.000000", "linux-x64"), "ledgr-20261001.000000-linux-x64.tar.gz");
  assert.equal(archiveName("20261001.000000", "macos-arm64"), "ledgr-20261001.000000-macos-arm64.zip");
  const m = parseManifest(MANIFEST);
  for (const k of ["windows-x64", "macos-arm64", "macos-x64", "linux-x64"]) assert.equal(manifestFileFor(m, k)?.name, archiveName("20261001.000000", k));
  assert.equal(manifestFileFor(m, "linux-arm64"), null);
});
const installTemplate = readFileSync("scripts/install.sh", "utf8");
ok("install.sh is filled with one release's facts, and only its Mac/Linux archives' checksums", () => {
  const out = renderInstallScript(installTemplate, { manifest: MANIFEST, base: "https://github.com/strategicli/ledgr/releases/download/pkg-main-20261001.000000/" });
  assert.match(out, /^VERSION="20261001\.000000"$/m);
  assert.match(out, /^CHANNEL="main"$/m);
  assert.match(out, /^BASE="https:\/\/github\.com\/strategicli\/ledgr\/releases\/download\/pkg-main-20261001\.000000"$/m);
  const sums = /^SUMS="([^"]*)"$/m.exec(out)?.[1].split("\n") ?? [];
  assert.deepEqual(sums.map((l) => l.split(" ")[0]), ["macos-arm64", "macos-x64", "linux-x64"]);
  for (const l of sums) assert.match(l, /^\S+ ledgr-\S+ [0-9a-f]{64}$/);
  assert.equal(/__LEDGR_[A-Z]+__/.test(out), false);
  // The unfilled template refuses to run.
  assert.match(installTemplate, /case "\$VERSION" in \*LEDGR\*\) die/);
});
ok("a manifest without Mac/Linux archives, an odd address or channel is refused", () => {
  const winOnly = { ...MANIFEST, files: MANIFEST.files.filter((f) => f.platform === "windows-x64") };
  assert.throws(() => renderInstallScript(installTemplate, { manifest: winOnly, base: "https://x/y" }), /no Mac or Linux/);
  assert.throws(() => renderInstallScript(installTemplate, { manifest: MANIFEST, base: "http://x/y" }), /bad base/);
  assert.throws(() => renderInstallScript(installTemplate, { manifest: MANIFEST, base: "https://x/$(id)" }), /bad base/);
  assert.throws(() => renderInstallScript(installTemplate, { manifest: { ...MANIFEST, channel: 'a"b' }, base: "https://x/y" }), /bad channel/);
});
ok("install.sh never asks for sudo, checks the sha256, and deletes data only after DELETE and a second yes", () => {
  const code = installTemplate.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  assert.equal(/\bsudo\b/.test(code), false);
  assert.match(code, /\[ "\$got" = "\$sum" \] \|\| die/);
  assert.equal((code.match(/rm -rf "\$DATA"/g) ?? []).length, 1);
  assert.match(code, /if \[ "\$answer" = "DELETE" \]; then\s+rm -rf "\$DATA"/);
  assert.match(code, /case "\$sure" in y \| Y \| yes \| YES\) ;; \*\) answer="" ;; esac/);
  // The new program is unpacked and checked before the running one is stopped.
  assert.ok(code.indexOf('tar -xf "$tmp/$file"') < code.indexOf('"$HELPER" stop'));
  for (const verb of ["stop", "prepare", "launchers", "start", "open", "uninstall"]) assert.ok(code.includes(`"$HELPER" ${verb}`), verb);
});
ok("login item names: the installed copy's own, and a git install's documented ones", () => {
  assert.equal(launchAgentLabel(INSTALLED_STARTUP_NAME), "org.ledgr.app");
  assert.equal(systemdUnitName(INSTALLED_STARTUP_NAME), "ledgr-app.service");
  assert.equal(launchAgentLabel(null), "org.ledgr.supervisor");
  assert.equal(systemdUnitName(STARTUP_TASK_NAME), "ledgr-supervisor.service");
  const mac = loginItemPaths("darwin", "/Users/jane", INSTALLED_STARTUP_NAME);
  assert.match(mac!.file, /[\\/]Users[\\/]jane[\\/]Library[\\/]LaunchAgents[\\/]org\.ledgr\.app\.plist$/);
  const lin = loginItemPaths("linux", "/home/jane", INSTALLED_STARTUP_NAME, { XDG_CONFIG_HOME: "/cfg" });
  assert.match(lin!.file, /^[\\/]cfg[\\/]systemd[\\/]user[\\/]ledgr-app\.service$/);
  assert.match(lin!.wants!, /default\.target\.wants[\\/]ledgr-app\.service$/);
  assert.equal(loginItemPaths("win32", "C:\\Users\\j", INSTALLED_STARTUP_NAME), null);
});
ok("the entry runs the install folder's Node and ledgr-ctl, or a git install's own", () => {
  const pkg = loginItemCommand({ repoDir: "/opt/ledgr", here: "/x/supervisor", execPath: "/usr/bin/node", exists: () => true });
  assert.match(pkg.node, /[\\/]opt[\\/]ledgr[\\/]node[\\/]bin[\\/]node$/);
  assert.match(pkg.ctl, /[\\/]opt[\\/]ledgr[\\/]supervisor[\\/]ledgr-ctl\.mjs$/);
  const git = loginItemCommand({ repoDir: "/src/ledgr", here: "/src/ledgr/supervisor", execPath: "/usr/bin/node", exists: () => false });
  assert.equal(git.node, "/usr/bin/node");
  assert.match(git.ctl, /[\\/]src[\\/]ledgr[\\/]supervisor[\\/]ledgr-ctl\.mjs$/);
});
const SPACEY = { node: "/Users/Jane Doe/Library/Application Support/Ledgr/app/node/bin/node", ctl: "/Users/Jane Doe/L&R/ledgr-ctl.mjs", configPath: "/d/100%/con$fig.json" };
ok("the launchd agent runs boot once at sign-in, escaped, and lets the service outlive it", () => {
  const p = renderLaunchAgent({ label: "org.ledgr.app", ...SPACEY, path: "/usr/bin:/bin", log: "/d/login-item.log" });
  assert.ok(p.includes("<string>/Users/Jane Doe/L&amp;R/ledgr-ctl.mjs</string>"));
  assert.ok(p.includes("<string>boot</string>") && p.includes("<string>--config=/d/100%/con$fig.json</string>"));
  assert.match(p, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(p, /<key>AbandonProcessGroup<\/key>\s*<true\/>/);
  assert.equal(/KeepAlive/.test(p), false);
});
ok("the systemd unit quotes paths with spaces, % and $, and stops Ledgr cleanly", () => {
  const u = renderSystemdUnit({ ...SPACEY, path: "/usr/bin:/bin" });
  assert.ok(u.includes('ExecStart="/Users/Jane Doe/Library/Application Support/Ledgr/app/node/bin/node" "/Users/Jane Doe/L&R/ledgr-ctl.mjs" "boot" "--config=/d/100%%/con$$fig.json"'));
  assert.ok(u.includes(' "stop" "--config=/d/100%%/con$$fig.json"'));
  assert.ok(u.includes('Environment="PATH=/usr/bin:/bin"'));
  for (const line of ["Type=oneshot", "RemainAfterExit=yes", "KillMode=process", "WantedBy=default.target"]) assert.ok(u.includes(line), line);
});
ok("a Mac login item switched off in System Settings reads as off", () => {
  const text = `disabled services = {\n\t"com.apple.x" => enabled\n\t"org.ledgr.app" => disabled\n}\n`;
  assert.equal(launchdDisabled(text, "org.ledgr.app"), true);
  assert.equal(launchdDisabled(text, "org.ledgr.supervisor"), false);
  assert.equal(launchdDisabled(`"org.ledgr.app" => true`, "org.ledgr.app"), true);
  assert.equal(launchdDisabled(`"org.ledgr.app" => enabled`, "org.ledgr.app"), false);
  assert.equal(launchdDisabled(`"org.ledgrXapp" => disabled`, "org.ledgr.app"), false);
});
ok("the record the app reads follows what the computer holds", () => {
  const on = { enabled: true, scope: "logon" as const, ok: true, detail: null, command: null, caveat: null, at: null };
  assert.equal(reconcileStartupRecord(on, { registered: true, blocked: false, scope: "logon" }), null);
  assert.deepEqual(reconcileStartupRecord(on, { registered: true, blocked: false, scope: "always" }), { enabled: true, scope: "always", ok: true, caveat: null });
  assert.deepEqual(reconcileStartupRecord(on, { registered: false, blocked: false, scope: null }), { enabled: false, scope: "logon", ok: true });
  assert.equal(reconcileStartupRecord(on, { registered: false, blocked: true, scope: "logon" })?.ok, false);
  // No record, but an entry made by hand: now the box says so.
  assert.deepEqual(reconcileStartupRecord(null, { registered: true, blocked: false, scope: "logon" }), { enabled: true, scope: "logon", ok: true, caveat: null });
  // A failed request that left nothing behind keeps its explanation.
  assert.equal(reconcileStartupRecord({ ...on, ok: false, detail: "why" }, { registered: false, blocked: false, scope: null }), null);
  assert.equal(reconcileStartupRecord(null, null), null);
});
ok("on a Mac or Linux, only this install's processes are ended (paths with spaces too)", () => {
  const app = "/Users/Jane Doe/Library/Application Support/Ledgr/app";
  const data = "/Users/Jane Doe/Library/Application Support/Ledgr/data";
  const ps = parsePsList(
    `  101 ${app}/node/bin/node ${app}/supervisor/ledgr-supervisor.mjs ${data}/config.json\n` +
      `  102 ${app}/node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres -D ${data}/pg\n` +
      `  103 ${data}/builds/20261002.000000/node/bin/node server.js\n` +
      `  104 /opt/homebrew/bin/node /Users/Jane Doe/dev/ledgr/supervisor/ledgr-supervisor.mjs\n` +
      `  105 /usr/bin/vim ${app}/supervisor/lib.mjs\n`
  );
  assert.deepEqual(ps.map((p) => p.pid), [101, 102, 103, 104, 105]);
  assert.deepEqual(ps.filter((p) => isOwnProcess(p, app, data)).map((p) => p.pid), [101, 102, 103]);
  assert.equal(isLedgrCommandLine(ps[3].cmdline), true);
});
ok("launchers: a Mac app bundle's script and a Linux desktop entry, quoted for their shells", () => {
  const m = renderMacLauncher({ name: "Ledgr", verb: "open", node: "/a b/node", ctl: "/it's/ledgr-ctl.mjs", configPath: "/d/config.json", log: "/d/launcher.log", id: "org.ledgr.launcher.ledgr" });
  assert.ok(m.script.includes(`exec '/a b/node' '/it'\\''s/ledgr-ctl.mjs' open '--config=/d/config.json' >>'/d/launcher.log' 2>&1`));
  assert.match(m.plist, /<key>CFBundleExecutable<\/key>\s*<string>run<\/string>/);
  const d = renderDesktopEntry({ node: "/a b/node", ctl: "/c/ledgr-ctl.mjs", configPath: "/d/50%/config.json", icon: "/i.png" });
  assert.ok(d.includes('Exec="/a b/node" "/c/ledgr-ctl.mjs" "open" "--config=/d/50%%/config.json"'));
  assert.match(d, /^Actions=stop;reset-password;$/m);
  assert.match(d, /\[Desktop Action stop\]\nName=Stop Ledgr\nExec=.*"stop"/);
  assert.deepEqual(LAUNCHERS.map((l) => l.verb), ["open", "stop", "reset-password"]);
  assert.match(launcherPaths("linux", "/home/j", INSTALLED_STARTUP_NAME, {})!.file!, /applications[\\/]ledgr-app\.desktop$/);
  assert.equal(launcherPaths("darwin", "/Users/j", INSTALLED_STARTUP_NAME)!.apps!.length, 3);
});

console.log(`\n${checks} checks passed.`);
