#!/usr/bin/env node
// Build a ready-made Ledgr package for THIS computer's platform (ADR-278).
//
//   node scripts/package.mjs                      # build, assemble, archive
//   node scripts/package.mjs --skip-build         # reuse an existing standalone build
//   node scripts/package.mjs --channel main --version 20260925.214405 --out dist/package
//
// The package workflow (.github/workflows/package.yml) runs exactly this on each
// platform's own runner, and a builder runs it locally to test an install
// (runbook §1s). It builds on the platform it packages for because Next's
// standalone output carries native pieces (image resizing, the agent SDK) that
// only work on the platform they were installed on.
//
// Output, in --out (default dist/package):
//   ledgr/                          the unpacked package (what an install serves)
//   ledgr-<version>-<platform>.zip  the archive (tar.gz on Linux)
//   manifest-<platform>.json        version, commit, channel, and the archive's sha256
//
// Everything downloaded (Node, pg_dump/pg_restore) is pinned by sha256 in
// scripts/package-pins.json and refused when it does not match.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { extractCommand } from "../supervisor/lib.mjs";
import {
  PACKAGE_INFO_FILE,
  archiveName,
  channelSlug,
  githubSlug,
  isVersion,
  parseManifest,
  platformKey,
  versionFor,
} from "../supervisor/release.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const { values: opt } = parseArgs({
  options: {
    channel: { type: "string" },
    version: { type: "string" },
    out: { type: "string", default: "dist/package" },
    cache: { type: "string", default: ".package-cache" },
    "skip-build": { type: "boolean", default: false },
  },
});

function fail(msg) {
  console.error(`package: ${msg}`);
  process.exit(1);
}
function step(msg) {
  console.log(`package: ${msg}`);
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed: ${(r.stderr || r.stdout || String(r.error ?? "")).trim()}`);
  return (r.stdout ?? "").trim();
}

const key = platformKey(process.platform, process.arch);
const pins = JSON.parse(readFileSync(join(repoRoot, "scripts", "package-pins.json"), "utf8")).platforms?.[key];
if (!pins) fail(`no pins for ${key} in scripts/package-pins.json; this platform is not packaged yet`);

const commit = sh("git", ["rev-parse", "HEAD"]);
const channel = opt.channel || sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const version = opt.version || versionFor(new Date());
if (!isVersion(version)) fail(`--version must look like 20260925.214405, got ${version}`);
if (!channelSlug(channel)) fail("no channel");
const repo = githubSlug(sh("git", ["remote", "get-url", "origin"])) ?? "strategicli/ledgr";
const out = resolve(repoRoot, opt.out);
const cache = resolve(repoRoot, opt.cache);
const root = join(out, "ledgr");
step(`${key}, channel ${channel}, version ${version}, commit ${commit.slice(0, 7)}`);

// ── 1. The standalone app ────────────────────────────────────────────────────
// next build reads .env files from the checkout and bakes any NEXT_PUBLIC_
// value into the pages. Packages for other people come from CI, which has none.
const envFiles = readdirSync(repoRoot).filter((f) => /^\.env/.test(f) && f !== ".env.example");
if (envFiles.length > 0) {
  console.warn(`package: WARNING this checkout has ${envFiles.join(", ")}; a package built here carries their NEXT_PUBLIC_ values. Fine for testing, never publish it.`);
}
if (!opt["skip-build"]) {
  step("next build (standalone)…");
  const r = spawnSync(process.execPath, [join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", LEDGR_STANDALONE: "1" },
  });
  if (r.status !== 0) fail("next build failed");
}
const standalone = join(repoRoot, ".next", "standalone");
if (!existsSync(join(standalone, "server.js"))) {
  fail(".next/standalone/server.js is missing; build with LEDGR_STANDALONE=1 (drop --skip-build)");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
// Links are copied as the files they point at. Next's build leaves symlinks in
// .next/node_modules wherever the OS allows them (GitHub's Windows runner does),
// pointing at absolute paths on the build machine, and an ordinary Windows
// account cannot even create one when unpacking (found 2026-09-25).
const COPY_OPTS = { recursive: true, dereference: true };
const copy = (from, to) => cpSync(join(repoRoot, from), join(root, to), COPY_OPTS);

step("assembling the app…");
// Only what the standalone server runs from. Next's file tracing pulls in the
// whole project when code reads files relative to the working directory, and a
// builder's checkout can hold .env files with real secrets, so the app folder
// is an allowlist, never "whatever the trace copied".
const APP_KEEP = new Set([".next", "node_modules", "server.js", "package.json"]);
mkdirSync(join(root, "app"), { recursive: true });
for (const name of readdirSync(standalone)) {
  if (APP_KEEP.has(name)) cpSync(join(standalone, name), join(root, "app", name), COPY_OPTS);
}
copy(".next/static", "app/.next/static");
copy("public", "app/public");
// Read at run time from the app's working directory (the transcription job).
copy("scripts/whisper-transcribe.py", "app/scripts/whisper-transcribe.py");

// ── 2. Migrations, the supervisor, and what they load ───────────────────────
step("adding migrations and the supervisor…");
copy("drizzle", "drizzle");
copy("scripts/migrate.mjs", "scripts/migrate.mjs");
for (const f of readdirSync(join(repoRoot, "supervisor"))) {
  // Never a real config (config.json and friends hold an install's settings).
  if (/^config(?!\.example).*\.json$/.test(f)) continue;
  if (statSync(join(repoRoot, "supervisor", f)).isFile()) copy(`supervisor/${f}`, `supervisor/${f}`);
}
copy("tailnet/release.json", "tailnet/release.json");

/** Copy packages and everything they depend on from the repo's node_modules. */
function copyClosure(names) {
  const from = join(repoRoot, "node_modules");
  const seen = new Set();
  const queue = names.map((n) => ({ n, optional: false, parent: null }));
  while (queue.length) {
    const { n, optional, parent } = queue.shift();
    if (seen.has(n)) continue;
    const src = join(from, n);
    if (!existsSync(src)) {
      // Optional (another platform's binaries), or nested inside its parent.
      if (optional || (parent && existsSync(join(parent, "node_modules", n)))) continue;
      fail(`node_modules/${n} is missing; run npm ci first`);
    }
    seen.add(n);
    cpSync(src, join(root, "node_modules", n), COPY_OPTS);
    const pj = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
    for (const d of Object.keys(pj.dependencies ?? {})) queue.push({ n: d, optional: false, parent: src });
    for (const d of Object.keys(pj.optionalDependencies ?? {})) queue.push({ n: d, optional: true, parent: src });
  }
  return [...seen];
}
// The supervisor needs embedded-postgres (and this platform's server binaries)
// and pg; migrate.mjs needs pg and drizzle-orm's migrator, which the traced app
// does not carry because the app never imports it.
const deps = copyClosure(["embedded-postgres", "pg", "drizzle-orm"]);
step(`supervisor dependencies: ${deps.length} packages`);
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "ledgr-package", private: true }, null, 2) + "\n");

// ── 3. Pinned downloads: Node and the Postgres client tools ─────────────────
function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
async function pinned(pin) {
  mkdirSync(cache, { recursive: true });
  const file = join(cache, pin.url.split("/").pop());
  if (!existsSync(file) || sha256File(file) !== pin.sha256) {
    step(`downloading ${pin.url}`);
    const res = await fetch(pin.url);
    if (!res.ok) fail(`HTTP ${res.status} for ${pin.url}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const got = sha256File(file);
  if (got !== pin.sha256) fail(`${pin.url} has sha256 ${got}, the pin says ${pin.sha256}; refusing it`);
  return file;
}
function extractPinned(archive, pin, dest) {
  const tmp = join(cache, "x", channelSlug(pin.url.split("/").pop()));
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const x = extractCommand(process.platform, archive, tmp, process.env.SystemRoot);
  sh(x.cmd, [...x.args, ...pin.files.map((f) => pin.from + f)]);
  mkdirSync(dest, { recursive: true });
  for (const f of pin.files) cpSync(join(tmp, pin.from, f), join(dest, f));
  rmSync(tmp, { recursive: true, force: true });
}

step(`Node ${pins.node.version}…`);
// node/node.exe on Windows, node/bin/node elsewhere (that pin lists "bin/node"), as nodeFor() expects.
extractPinned(await pinned(pins.node), pins.node, join(root, "node"));
step("pg_dump / pg_restore…");
extractPinned(await pinned(pins.pgTools), pins.pgTools, join(root, "pgtools"));

// ── 4. What it is, then the archive and its manifest ────────────────────────
const builtAt = new Date().toISOString();
writeFileSync(
  join(root, PACKAGE_INFO_FILE),
  JSON.stringify({ schema: 1, version, commit, channel, platform: key, repo, node: pins.node.version, builtAt }, null, 2) + "\n"
);

// A package holds plain files only (see COPY_OPTS): refuse to archive a link.
const links = readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isSymbolicLink());
if (links.length > 0) fail(`the package still holds links, e.g. ${join(links[0].parentPath, links[0].name)}`);

const archive = join(out, archiveName(version, key));
step(`archiving ${archive}…`);
const tar = extractCommand(process.platform, "", "", process.env.SystemRoot).cmd;
sh(tar, archive.endsWith(".zip") ? ["--format", "zip", "-cf", archive, "-C", root, "."] : ["-czf", archive, "-C", root, "."]);

const manifest = parseManifest({
  schema: 1,
  version,
  commit,
  channel,
  repo,
  builtAt,
  files: [{ name: archiveName(version, key), platform: key, sha256: sha256File(archive), size: statSync(archive).size }],
});
writeFileSync(join(out, `manifest-${key}.json`), JSON.stringify(manifest, null, 2) + "\n");
step(`done: ${Math.round(manifest.files[0].size / 1e6)} MB, sha256 ${manifest.files[0].sha256}`);
