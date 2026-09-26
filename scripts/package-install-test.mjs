#!/usr/bin/env node
// Install a freshly built Mac or Linux package the way a person would, on a
// real Mac or Linux machine (the package workflow's install-test job), and
// check what a person would notice. Not a pure verify script (it installs
// into this user's home), which is why it is not named verify-*.
//
//   node scripts/package-install-test.mjs --dist <folder with ledgr-<v>-<platform>.* and manifest-<platform>.json>
//
// 1. install.sh, rendered for this package with a file:// download address,
//    installs it: checksum, unpack, prepare, start, open the setup page.
// 2. The setup page answers, and the first-run owner is made with the one-time
//    ticket (the same two server actions the /setup form calls).
// 3. Start with the computer is really registered (launchd agent / systemd
//    unit), the app says so, and the entry itself starts Ledgr from cold.
// 4. "Snapshot now" works, which runs the package's own pg_dump.
// 5. An update whose download fails its checksum is refused and the old
//    build keeps serving; install.sh then upgrades in place (data kept); a good
//    update is taken; an older install.sh refuses to go backwards.
// 6. Uninstall removes the program and its entries and keeps the data.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { archiveName, packageTag, parseManifest, platformKey, renderInstallScript, versionFor } from "../supervisor/release.mjs";
import { launchAgentLabel, loginItemPaths, systemdUnitName } from "../supervisor/login-item.mjs";
import { INSTALLED_STARTUP_NAME } from "../supervisor/installer.mjs";

const { values: opt } = parseArgs({ options: { dist: { type: "string" } } });
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const key = platformKey(process.platform, process.arch);
const dist = resolve(opt.dist ?? "dist");
const base = parseManifest(JSON.parse(readFileSync(join(dist, `manifest-${key}.json`), "utf8")));
const mac = process.platform === "darwin";
const ROOT = mac ? join(homedir(), "Library", "Application Support", "Ledgr") : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "ledgr");
const APP = join(ROOT, "app");
const DATA = join(ROOT, "data");
const work = mkdtempSync(join(tmpdir(), "ledgr-install-test-"));
const template = readFileSync(join(repoRoot, "scripts", "install.sh"), "utf8");

let passed = 0;
function ok(what) {
  passed += 1;
  console.log(`  ✓ ${what}`);
}
function tail(file, n = 60) {
  try {
    return readFileSync(file, "utf8").split("\n").slice(-n).join("\n");
  } catch {
    return "(none)";
  }
}
function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  for (const f of ["install.log", "supervisor.log", "supervisor.err.log", "login-item.log", "launcher.log"]) {
    console.error(`── ${f} ──\n${tail(join(DATA, f))}\n`);
  }
  process.exit(1);
}
function check(cond, what) {
  if (!cond) fail(what);
  ok(what);
}
function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  console.log(out.split("\n").map((l) => `    | ${l}`).join("\n"));
  return { code: r.status, out };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // not yet
    }
    await sleep(2000);
  }
  fail(`timed out waiting for: ${what}`);
}
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const config = () => JSON.parse(readFileSync(join(DATA, "config.json"), "utf8"));
const live = () => JSON.parse(readFileSync(join(DATA, "live.json"), "utf8"));
const url = (p) => `http://localhost:${config().appPort}${p}`;
const node = () => join(APP, "node", "bin", "node");
const ctl = (verb, env = {}) => run(node(), [join(APP, "supervisor", "ledgr-ctl.mjs"), verb, `--config=${join(DATA, "config.json")}`], env);
async function answers() {
  try {
    const r = await fetch(url("/setup"), { signal: AbortSignal.timeout(5000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

/** install.sh for one release folder, downloading from it with file://. */
function installScript(dir, manifest) {
  const p = join(dir, "install.sh");
  writeFileSync(p, renderInstallScript(template, { manifest, base: `file://${dir}` }));
  return p;
}

/** The same build under a newer version number: a second package to upgrade to. */
function repackage(version) {
  const src = join(dist, base.files[0].name);
  const unpacked = join(work, `pkg-${version}`);
  const dir = join(work, `rel-${version}`);
  mkdirSync(unpacked, { recursive: true });
  mkdirSync(dir, { recursive: true });
  if (spawnSync("tar", ["-xf", src, "-C", unpacked]).status !== 0) fail("could not unpack the package to make a second one");
  const infoPath = join(unpacked, "ledgr-package.json");
  writeFileSync(infoPath, JSON.stringify({ ...JSON.parse(readFileSync(infoPath, "utf8")), version }, null, 2) + "\n");
  const name = archiveName(version, key);
  const archive = join(dir, name);
  const args = name.endsWith(".zip") ? ["--format", "zip", "-cf", archive, "-C", unpacked, "."] : ["-czf", archive, "-C", unpacked, "."];
  if (spawnSync("tar", args).status !== 0) fail("could not archive the second package");
  rmSync(unpacked, { recursive: true, force: true });
  const manifest = parseManifest({ ...base, version, files: [{ name, platform: key, sha256: sha256(archive), size: statSync(archive).size }] });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dir, manifest, archive, name };
}

function versionPlus(v, seconds) {
  const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13), +v.slice(13, 15)));
  return versionFor(new Date(d.getTime() + seconds * 1000));
}

// ── A stand-in for GitHub's releases list (LEDGR_RELEASES_API, runbook §1s) ──
let offer = null; // { pkg, corrupt }
const server = createServer((req, res) => {
  const addr = `http://127.0.0.1:${server.address().port}`;
  if (!offer) return res.writeHead(404).end();
  const { pkg, corrupt } = offer;
  if (/\/releases(\?|$)/.test(req.url)) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify([
        {
          tag_name: packageTag(base.channel, pkg.manifest.version),
          draft: false,
          target_commitish: base.commit,
          assets: [
            { name: "manifest.json", browser_download_url: `${addr}/dl/manifest.json` },
            { name: pkg.name, browser_download_url: `${addr}/dl/${pkg.name}` },
          ],
        },
      ])
    );
  }
  if (req.url === "/dl/manifest.json") {
    const m = corrupt ? { ...pkg.manifest, files: pkg.manifest.files.map((f) => ({ ...f, sha256: "0".repeat(64) })) } : pkg.manifest;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(m));
  }
  if (req.url === `/dl/${pkg.name}`) {
    res.writeHead(200, { "content-length": statSync(pkg.archive).size });
    return createReadStream(pkg.archive).pipe(res);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const RELEASES = { LEDGR_RELEASES_API: `http://127.0.0.1:${server.address().port}` };

// ── Server actions, called the way the /setup form calls them ────────────────
function actionId(name) {
  const m = JSON.parse(readFileSync(join(APP, "app", ".next", "server", "server-reference-manifest.json"), "utf8"));
  for (const [id, entry] of Object.entries(m.node ?? {})) {
    if (Object.values(entry.workers ?? {}).some((w) => w?.exportedName === name)) return id;
  }
  fail(`no server action named ${name} in the package`);
}
/** The action's own return value inside a flight row: the first object carrying a boolean `ok`. */
function findResult(v, depth = 0) {
  if (!v || typeof v !== "object" || depth > 4) return null;
  if (typeof v.ok === "boolean") return v;
  for (const x of Object.values(v)) {
    const hit = findResult(x, depth + 1);
    if (hit) return hit;
  }
  return null;
}
async function action(name, args) {
  // The app restarts itself once sign-in turns on (it then listens beyond this
  // machine), so a refused connection is retried rather than read as a failure.
  const res = await waitFor(`${name} to answer`, () =>
    fetch(url("/setup"), {
      method: "POST",
      headers: {
        "next-action": actionId(name),
        "content-type": "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: url(""),
      },
      body: JSON.stringify(args),
    })
  );
  const text = await res.text();
  for (const line of text.split("\n")) {
    const m = /^[0-9a-f]+:(\{.*\})\s*$/.exec(line);
    if (!m) continue;
    try {
      const v = findResult(JSON.parse(m[1]));
      if (v) return { result: v, cookies: res.headers.getSetCookie() };
    } catch {
      // not the result line
    }
  }
  fail(`${name} gave no result (HTTP ${res.status}): ${text.slice(0, 600)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`Installing ${base.files[0].name} (${key}) into ${ROOT}`);
rmSync(ROOT, { recursive: true, force: true });

console.log("1. install.sh");
const first = installScript(dist, base);
const inst = run("sh", [first], RELEASES);
check(inst.code === 0, "install.sh finished");
check(existsSync(join(APP, "ledgr-package.json")) && existsSync(join(DATA, "config.json")), "program and data folders are separate and in place");
check(await answers(), "Ledgr answers on its port");
check(config().startupName === INSTALLED_STARTUP_NAME, `this copy's entries are named "${INSTALLED_STARTUP_NAME}"`);

console.log("2. First-run setup with the one-time ticket");
const ticket = [...inst.out.matchAll(/\/setup#([A-Za-z0-9_-]+)/g)].at(-1)?.[1];
check(!!ticket, "the installer opened /setup with a ticket");
const page = await fetch(url("/setup"));
check(page.status === 200, "the setup page answers");
const pw = "correct horse battery staple 42";
const made = await action("createOwnerAtMachine", [ticket, "owner@example.com", pw, pw]);
check(made.result.ok && made.result.kit?.length === 10, "the owner is created and a ten-code recovery kit comes back");
const done = await action("finishResetAtMachine", [ticket, made.result.kit[0]]);
check(done.result.ok && done.cookies.length > 0, "typing one code back finishes setup and signs this browser in");
const cookie = done.cookies.map((c) => c.split(";")[0]).join("; ");
const again = await action("createOwnerAtMachine", [ticket, "intruder@example.com", pw, pw]);
check(!again.result.ok, "the ticket works once only");
const authed = (p, init = {}) => fetch(url(p), { ...init, headers: { ...(init.headers ?? {}), cookie } });

console.log("3. Start with the computer");
const entry = loginItemPaths(process.platform, homedir(), INSTALLED_STARTUP_NAME, process.env);
check(existsSync(entry.file) && (!entry.wants || !!lstatSync(entry.wants)), `the ${mac ? "launchd agent" : "systemd user unit"} is written and enabled (${entry.file})`);
const report = await waitFor("the app to report start-at-sign-in", async () => {
  const r = await authed("/api/startup");
  const j = r.ok ? await r.json() : null;
  return j?.state && !j.pending ? j : null;
});
check(report.available && report.state.enabled && report.state.ok, `Build → Updates says it is on (${report.state.scope})`);
ctl("stop");
check(!(await answers()), "stopped");
if (mac) {
  run("launchctl", ["kickstart", `gui/${userInfo().uid}/${launchAgentLabel(INSTALLED_STARTUP_NAME)}`]);
} else {
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "start", systemdUnitName(INSTALLED_STARTUP_NAME)]);
}
await waitFor("the login item to start Ledgr", answers);
ok(`the ${mac ? "launchd agent" : "systemd unit"} starts Ledgr from cold`);
const status = ctl("status");
check(/at boot\s+registered/.test(status.out), "ledgr-ctl status agrees");
const sw = ctl("startup");
check(/Registered/.test(sw.out), "ledgr-ctl startup agrees");
if (!mac) {
  // A oneshot unit stays "active" after its start command hands off, so the
  // stop it runs at sign-out (a clean ledgr-ctl stop) is exercised here too.
  run("systemctl", ["--user", "stop", systemdUnitName(INSTALLED_STARTUP_NAME)]);
  await waitFor("the unit's stop to stop Ledgr", async () => !(await answers()), 90_000);
  ok("stopping the unit stops Ledgr cleanly");
}

console.log("4. Snapshot now (the package's own pg_dump)");
ctl("stop");
ctl("boot", RELEASES); // from here on, updates list releases from the stand-in
await waitFor("Ledgr to answer", answers);
const snap = await waitFor("Snapshot now", async () => {
  const r = await authed("/api/snapshots", { method: "POST" });
  const j = await r.json();
  if (!j.ok) console.log(`    snapshot said: ${JSON.stringify(j)}`);
  return j.ok ? j : null;
}, 120_000);
check(!!snap.name, `a restore point was written (${snap.name})`);

console.log("5. Updates");
const v1 = base.version;
const v2 = repackage(versionPlus(v1, 1));
const v3 = repackage(versionPlus(v1, 2));
offer = { pkg: v2, corrupt: true };
writeFileSync(join(DATA, "update-requested"), "");
await waitFor("the corrupt update to be refused", () => /checksum mismatch/.test(tail(join(DATA, "supervisor.log"), 400)));
check(live().version === v1 && (await answers()), "a download that fails its checksum is refused and the old build keeps serving");

const up = run("sh", [installScript(v2.dir, v2.manifest)], RELEASES);
check(up.code === 0, "install.sh upgrades in place to a second package");
check(live().version === v2.manifest.version && (await answers()), `serving ${v2.manifest.version}`);
await waitFor("the owner's session to be accepted after the upgrade", async () => (await authed("/api/startup")).status === 200, 60_000);
ok("the owner and the signed-in session survived the upgrade");

offer = { pkg: v3, corrupt: false };
writeFileSync(join(DATA, "update-requested"), "");
await waitFor("the good update", () => live().version === v3.manifest.version);
await waitFor("Ledgr to answer after the update", answers);
ok(`a good update is taken (${v3.manifest.version}) from Build → Updates' Update now`);

const back = run("sh", [first], RELEASES);
check(back.code !== 0 && /newer Ledgr/.test(back.out), "an older install.sh refuses to go backwards");
check(await answers(), "and Ledgr keeps running");

console.log("6. Uninstall");
const un = run("sh", [first, "--uninstall"]);
check(un.code === 0, "uninstall finished");
check(!existsSync(APP), "the program is gone");
check(existsSync(join(DATA, "config.json")) && existsSync(join(DATA, "snapshots")), "the data is kept (no keyboard, so no question, so nothing deleted)");
check(!existsSync(entry.file), "the start-at-sign-in entry is gone");
check(!(await answers()), "Ledgr is stopped");

server.close();
console.log(`\n${passed} checks passed on ${key}.`);
