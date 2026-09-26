// Verification for the Windows installer's decisions (install plan step 7).
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

console.log(`\n${checks} checks passed.`);
