// Verification for ready-made packages and updating from them (ADR-278).
//
// Pure: no network, no database, no child processes. What has to hold:
//   1. Versions sort, tags are per channel and never match the helper's
//      `tailnet-v*`, and the newest package for a channel is picked correctly.
//   2. A manifest with a bad checksum, name or size is refused.
//   3. An install moves only to a strictly newer package.
//   4. Every existing install keeps its update path: no `source` in the policy
//      means "git" for a clone and "release" only for a package.
//   5. A git build starts exactly as before; a package build runs server.js
//      with its own Node, and restarts into the supervisor it serves.
//   6. next.config.ts asks for standalone output ONLY when the package build
//      sets LEDGR_STANDALONE=1, and never on Vercel.
//
// Run: npx tsx scripts/verify-release.mts
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  archiveName,
  channelSlug,
  compareVersions,
  githubSlug,
  isVersion,
  manifestFileFor,
  mergeManifests,
  packageTag,
  parseManifest,
  parsePackageInfo,
  pickNewestRelease,
  platformKey,
  shouldUpdate,
  updateSourceOf,
  versionFor,
  versionOfTag,
} from "../supervisor/release.mjs";
import {
  appCommand,
  extractCommand,
  nextStartArgs,
  nodeFor,
  packageRootOf,
  parseLivePointer,
  serializeLivePointer,
  supervisorLaunch,
} from "../supervisor/lib.mjs";

let checks = 0;
function ok(what: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    checks += 1;
    console.log(`  ✓ ${what}`);
  });
}

const SHA = "a".repeat(40);
const SUM = "b".repeat(64);

console.log("1. Versions, tags and picking the newest");
await ok("a version is UTC date.time and sorts as it reads", () => {
  assert.equal(versionFor(new Date("2026-09-25T21:44:05.123Z")), "20260925.214405");
  assert.equal(isVersion("20260925.214405"), true);
  assert.equal(isVersion("1.2.3"), false);
  assert.equal(compareVersions("20260925.214405", "20261001.000000"), -1);
  assert.equal(compareVersions("20260925.214405", "20260925.214405"), 0);
  assert.equal(compareVersions("junk", "20260925.214405"), null);
});
await ok("tags are per channel and cannot collide with the Tailscale helper's", () => {
  assert.equal(channelSlug("feature/Big Thing"), "feature-big-thing");
  assert.equal(packageTag("prod-brandon", "20260925.214405"), "pkg-prod-brandon-20260925.214405");
  assert.equal(versionOfTag("pkg-main-20260925.214405", "main"), "20260925.214405");
  assert.equal(versionOfTag("pkg-prod-brandon-20260925.214405", "main"), null);
  assert.equal(versionOfTag("tailnet-v0.1.0", "main"), null);
  assert.equal(versionOfTag("pkg-main-latest", "main"), null);
});
const asset = (name: string) => ({ name, browser_download_url: `https://x/${name}` });
const releases = [
  { tag_name: "tailnet-v0.1.0", draft: false, assets: [asset("manifest.json")] },
  { tag_name: "pkg-main-20260924.100000", draft: false, target_commitish: SHA, assets: [asset("manifest.json"), asset("a.zip")] },
  { tag_name: "pkg-main-20260926.100000", draft: true, target_commitish: SHA, assets: [asset("manifest.json")] },
  { tag_name: "pkg-main-20260925.100000", draft: false, target_commitish: SHA, assets: [asset("manifest.json"), asset("b.zip")] },
  { tag_name: "pkg-main-20260927.100000", draft: false, target_commitish: SHA, assets: [asset("b.zip")] },
  { tag_name: "pkg-prod-brandon-20260930.100000", draft: false, target_commitish: SHA, assets: [asset("manifest.json")] },
];
await ok("the newest published package of the channel wins; drafts, other channels and manifest-less releases do not", () => {
  const n = pickNewestRelease(releases, "main");
  assert.ok(n);
  assert.equal(n.version, "20260925.100000");
  assert.equal(n.commit, SHA);
  assert.equal(n.manifestUrl, "https://x/manifest.json");
  assert.equal(n.assets["b.zip"], "https://x/b.zip");
  assert.equal(pickNewestRelease(releases, "prod-brandon")?.version, "20260930.100000");
  assert.equal(pickNewestRelease(releases, "nobody"), null);
  assert.equal(pickNewestRelease("not a list", "main"), null);
});

console.log("\n2. The manifest");
const good = {
  schema: 1,
  version: "20260925.100000",
  commit: SHA,
  channel: "main",
  repo: "strategicli/ledgr",
  files: [{ name: "ledgr-20260925.100000-windows-x64.zip", platform: "windows-x64", sha256: SUM, size: 10 }],
};
await ok("a good manifest parses and names the file for this platform", () => {
  const m = parseManifest(good);
  assert.equal(manifestFileFor(m, "windows-x64")?.sha256, SUM);
  assert.equal(manifestFileFor(m, "linux-x64"), null);
});
await ok("a bad checksum, a path in a name, a zero size or a missing commit is refused", () => {
  const f = good.files[0];
  assert.throws(() => parseManifest({ ...good, files: [{ ...f, sha256: "abc" }] }));
  assert.throws(() => parseManifest({ ...good, files: [{ ...f, name: "../evil.zip" }] }));
  assert.throws(() => parseManifest({ ...good, files: [{ ...f, size: 0 }] }));
  assert.throws(() => parseManifest({ ...good, commit: "HEAD" }));
  assert.throws(() => parseManifest({ ...good, schema: 2 }));
});
await ok("platform manifests of one build merge; builds that disagree do not", () => {
  const mac = { ...good, files: [{ ...good.files[0], name: "m.zip", platform: "macos-arm64" }] };
  assert.equal(mergeManifests([good, mac]).files.length, 2);
  assert.throws(() => mergeManifests([good, { ...mac, version: "20260926.100000" }]));
});
await ok("the package info file reads, and anything else is not a package", () => {
  assert.equal(parsePackageInfo(JSON.stringify({ version: "20260925.100000", commit: SHA }))?.version, "20260925.100000");
  assert.equal(parsePackageInfo("{}"), null);
  assert.equal(parsePackageInfo("nope"), null);
});
await ok("platform keys and archive names", () => {
  assert.equal(platformKey("win32", "x64"), "windows-x64");
  assert.equal(platformKey("darwin", "arm64"), "macos-arm64");
  assert.equal(platformKey("aix", "ppc64"), null);
  assert.equal(archiveName("20260925.100000", "windows-x64"), "ledgr-20260925.100000-windows-x64.zip");
  assert.equal(archiveName("20260925.100000", "linux-x64"), "ledgr-20260925.100000-linux-x64.tar.gz");
  assert.equal(githubSlug("https://github.com/strategicli/ledgr.git"), "strategicli/ledgr");
  assert.equal(githubSlug("git@github.com:a/b.git"), "a/b");
});

console.log("\n3. When to move");
await ok("only to a strictly newer package; a git build takes the newest", () => {
  assert.equal(shouldUpdate("20260925.100000", "20260926.100000"), true);
  assert.equal(shouldUpdate("20260925.100000", "20260925.100000"), false);
  assert.equal(shouldUpdate("20260926.100000", "20260925.100000"), false, "deleting a release never moves anyone back");
  assert.equal(shouldUpdate(null, "20260925.100000"), true);
  assert.equal(shouldUpdate("20260925.100000", null), false);
});

console.log("\n4. Which path an install takes");
await ok("the policy decides when it names a source", () => {
  assert.equal(updateSourceOf("git", true), "git");
  assert.equal(updateSourceOf("release", false), "release");
});
await ok("no source on file: a clone stays on git, a package takes packages", () => {
  assert.equal(updateSourceOf(null, false), "git");
  assert.equal(updateSourceOf(undefined, false), "git");
  assert.equal(updateSourceOf("bogus", false), "git");
  assert.equal(updateSourceOf(null, true), "release");
});

console.log("\n5. Starting the app and the supervisor");
const d = resolve("/data/builds/20260925.100000/app");
await ok("a git build runs `next start` exactly as before", () => {
  const c = appCommand("/b/abc", 3000, "127.0.0.1", false);
  assert.deepEqual(c.args, [join("/b/abc", "node_modules", "next", "dist", "bin", "next"), ...nextStartArgs(3000, "127.0.0.1")]);
  assert.deepEqual(c.env, {});
});
await ok("a package build runs server.js, on every network only when asked", () => {
  assert.deepEqual(appCommand(d, 3600, "127.0.0.1", true), { args: [join(d, "server.js")], env: { PORT: "3600", HOSTNAME: "127.0.0.1" } });
  assert.equal(appCommand(d, 3600, null, true).env.HOSTNAME, "0.0.0.0");
});
const pkgRoot = resolve(d, "..");
const inPackage = (p: string) => p === join(pkgRoot, "ledgr-package.json") || p.startsWith(pkgRoot);
await ok("a package root is found from its app dir; a git build has none", () => {
  assert.equal(packageRootOf(d, inPackage), pkgRoot);
  assert.equal(packageRootOf(resolve("/data/builds/abc"), () => false), null);
  assert.equal(packageRootOf(null, inPackage), null);
});
await ok("a package's own Node is used when it has one", () => {
  assert.equal(nodeFor(pkgRoot, "/usr/bin/node", true, inPackage), join(pkgRoot, "node", "node.exe"));
  assert.equal(nodeFor(pkgRoot, "/usr/bin/node", false, inPackage), join(pkgRoot, "node", "bin/node"));
  assert.equal(nodeFor(null, "/usr/bin/node", true, inPackage), "/usr/bin/node");
});
await ok("restart and boot start the serving package's supervisor; a git install starts its own", () => {
  const here = resolve("/install/supervisor");
  const pkg = supervisorLaunch({ here, execPath: "/n", liveDir: d, isWin: true, exists: inPackage });
  assert.equal(pkg.script, join(pkgRoot, "supervisor", "ledgr-supervisor.mjs"));
  assert.equal(pkg.node, join(pkgRoot, "node", "node.exe"));
  const git = supervisorLaunch({ here, execPath: "/n", liveDir: resolve("/data/builds/abc"), isWin: true, exists: () => false });
  assert.deepEqual(git, { node: "/n", script: join(here, "ledgr-supervisor.mjs") });
});
await ok("unpacking uses Windows' own tar (it reads zip), and plain tar elsewhere", () => {
  assert.equal(extractCommand("win32", "a.zip", "out", "C:\\Windows").cmd, join("C:\\Windows", "System32", "tar.exe"));
  assert.deepEqual(extractCommand("linux", "a.tar.gz", "out", undefined), { cmd: "tar", args: ["-xf", "a.tar.gz", "-C", "out"] });
});
await ok("the live pointer carries a package version, and a git pointer reads as before", () => {
  const p = parseLivePointer(serializeLivePointer(d, SHA, "20260925.100000"));
  assert.equal(p?.version, "20260925.100000");
  assert.equal(parseLivePointer(serializeLivePointer("/b/abc", "abc"))?.version, null);
  assert.equal(serializeLivePointer("/b/abc", "abc").includes("version"), false);
});

console.log("\n6. next.config.ts leaves every other build alone");
const saved = { s: process.env.LEDGR_STANDALONE, v: process.env.VERCEL };
const load = async (tag: string) => (await import(`../next.config.ts?${tag}`)).default as Record<string, unknown>;
await ok("without LEDGR_STANDALONE there is no output setting at all (Vercel, CI, build:satellite)", async () => {
  delete process.env.LEDGR_STANDALONE;
  delete process.env.VERCEL;
  const c = await load("plain");
  assert.equal("output" in c, false);
  assert.equal("outputFileTracingRoot" in c, false);
});
await ok("the package build gets standalone output", async () => {
  process.env.LEDGR_STANDALONE = "1";
  assert.equal((await load("pkg")).output, "standalone");
});
await ok("never on Vercel, even if the variable leaks there", async () => {
  process.env.LEDGR_STANDALONE = "1";
  process.env.VERCEL = "1";
  assert.equal("output" in (await load("vercel")), false);
});
if (saved.s === undefined) delete process.env.LEDGR_STANDALONE;
else process.env.LEDGR_STANDALONE = saved.s;
if (saved.v === undefined) delete process.env.VERCEL;
else process.env.VERCEL = saved.v;

console.log(`\n${checks} checks passed.`);
