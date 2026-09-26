// Ready-made packages (install plan step 6, ADR-278): the pure half.
//
// A package is one folder that runs Ledgr with nothing else installed: the
// standalone app, the supervisor and its few dependencies, a pinned Node, the
// embedded Postgres binaries and pg_dump/pg_restore. The package workflow
// (.github/workflows/package.yml) publishes one GitHub Release per push to a
// channel branch, tagged `pkg-<channel>-<version>`, holding one archive per
// platform plus `manifest.json` (the sha256 of every archive).
//
// Imported by the supervisor, by scripts/package.mjs, AND by the app
// (src/lib/updates.ts), so the "which package is newest for my channel" rule is
// written once. Keep it free of node: imports for that reason.

/** The file at a package's root that says what it is. Absent in a git build. */
export const PACKAGE_INFO_FILE = "ledgr-package.json";
/** The release asset listing every archive and its checksum. */
export const MANIFEST_ASSET = "manifest.json";
/** Tags start here. Cannot collide with the helper's `tailnet-v*`. */
export const TAG_PREFIX = "pkg-";
export const UPDATE_SOURCES = ["git", "release"];

/** A branch name as it appears in a tag: `prod-brandon`, `feature-x` for `feature/x`. */
export function channelSlug(branch) {
  return String(branch ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Versions ─────────────────────────────────────────────────────────────────
// `YYYYMMDD.HHMMSS`, UTC, from when the workflow ran. Sortable, readable
// ("built 25 Sept at 21:44"), and never reused because time only moves forward.

const VERSION_RE = /^(\d{8})\.(\d{6})$/;

export function isVersion(v) {
  return typeof v === "string" && VERSION_RE.test(v);
}

/** The version for a build that starts at `date`. */
export function versionFor(date) {
  const iso = new Date(date).toISOString(); // 2026-09-25T21:44:05.123Z
  return `${iso.slice(0, 10).replaceAll("-", "")}.${iso.slice(11, 19).replaceAll(":", "")}`;
}

/** -1, 0 or 1; null when either side is not a version. */
export function compareVersions(a, b) {
  if (!isVersion(a) || !isVersion(b)) return null;
  return a === b ? 0 : a < b ? -1 : 1; // fixed width digits: string order is numeric order
}

export function packageTag(channel, version) {
  return `${TAG_PREFIX}${channelSlug(channel)}-${version}`;
}

/** The version in a tag of this channel, or null for any other tag. */
export function versionOfTag(tag, channel) {
  const prefix = `${TAG_PREFIX}${channelSlug(channel)}-`;
  if (typeof tag !== "string" || !tag.startsWith(prefix)) return null;
  const v = tag.slice(prefix.length);
  return isVersion(v) ? v : null;
}

// ── Platforms ────────────────────────────────────────────────────────────────

/** `windows-x64`, `macos-arm64`, `macos-x64`, `linux-x64`, or null. */
export function platformKey(platform, arch) {
  const os = { win32: "windows", darwin: "macos", linux: "linux" }[platform];
  const cpu = { x64: "x64", arm64: "arm64" }[arch];
  return os && cpu ? `${os}-${cpu}` : null;
}

/** Zip for Windows and Mac (their own tar reads zip), tar.gz for Linux (GNU tar cannot). */
export function archiveName(version, key) {
  return `ledgr-${version}-${key}.${key.startsWith("linux-") ? "tar.gz" : "zip"}`;
}

// ── The manifest and the package info file ───────────────────────────────────

const SHA_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

function bad(what) {
  return new Error(`not a Ledgr package manifest: ${what}`);
}

/** Validate a parsed manifest. Throws with the reason; returns a clean copy. */
export function parseManifest(v) {
  if (!v || typeof v !== "object") throw bad("not an object");
  if (v.schema !== 1) throw bad(`unknown schema ${JSON.stringify(v.schema)}`);
  if (!isVersion(v.version)) throw bad(`bad version ${JSON.stringify(v.version)}`);
  if (typeof v.commit !== "string" || !COMMIT_RE.test(v.commit)) throw bad("bad commit");
  if (typeof v.channel !== "string" || !channelSlug(v.channel)) throw bad("no channel");
  if (!Array.isArray(v.files) || v.files.length === 0) throw bad("no files");
  const files = v.files.map((f) => {
    if (!f || typeof f.name !== "string" || !f.name || /[\\/]/.test(f.name)) throw bad("a file has a bad name");
    if (typeof f.platform !== "string" || !f.platform) throw bad(`${f.name} has no platform`);
    if (typeof f.sha256 !== "string" || !SHA_RE.test(f.sha256)) throw bad(`${f.name} has a bad sha256`);
    if (!Number.isInteger(f.size) || f.size <= 0) throw bad(`${f.name} has a bad size`);
    return { name: f.name, platform: f.platform, sha256: f.sha256, size: f.size };
  });
  return {
    schema: 1,
    version: v.version,
    commit: v.commit,
    channel: v.channel,
    repo: typeof v.repo === "string" ? v.repo : "",
    builtAt: typeof v.builtAt === "string" ? v.builtAt : null,
    files,
  };
}

/** Merge per-platform manifests of ONE build into the release's manifest. */
export function mergeManifests(parts) {
  const clean = parts.map(parseManifest);
  const first = clean[0];
  for (const m of clean) {
    if (m.version !== first.version || m.commit !== first.commit || m.channel !== first.channel) {
      throw bad("the platform builds disagree on version, commit or channel");
    }
  }
  return { ...first, files: clean.flatMap((m) => m.files) };
}

export function manifestFileFor(manifest, key) {
  return manifest.files.find((f) => f.platform === key) ?? null;
}

/** ledgr-package.json, tolerant: null when it is not one. */
export function parsePackageInfo(text) {
  try {
    const v = JSON.parse(text);
    if (!v || !isVersion(v.version) || typeof v.commit !== "string" || !COMMIT_RE.test(v.commit)) return null;
    return {
      version: v.version,
      commit: v.commit,
      channel: typeof v.channel === "string" ? v.channel : "",
      platform: typeof v.platform === "string" ? v.platform : "",
      repo: typeof v.repo === "string" ? v.repo : "",
    };
  } catch {
    return null;
  }
}

// ── Choosing ─────────────────────────────────────────────────────────────────

/**
 * The newest published package for a channel, from GitHub's list of releases
 * (GET /repos/{repo}/releases). Drafts, other channels, the helper's tags and
 * releases missing a manifest are all ignored. Null when there is none.
 *
 * `commit` comes from the release's target, which the workflow sets to the
 * exact commit it built, so the app can say what an update contains without
 * downloading anything.
 */
export function pickNewestRelease(releases, channel) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft) continue;
    const version = versionOfTag(r.tag_name, channel);
    if (!version) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const manifest = assets.find((a) => a?.name === MANIFEST_ASSET);
    if (!manifest?.browser_download_url) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      tag: r.tag_name,
      version,
      commit: typeof r.target_commitish === "string" && COMMIT_RE.test(r.target_commitish) ? r.target_commitish : null,
      manifestUrl: manifest.browser_download_url,
      assets: Object.fromEntries(
        assets.filter((a) => a?.name && a.browser_download_url).map((a) => [a.name, a.browser_download_url])
      ),
    };
  }
  return best;
}

/**
 * Move to `newest` only when it is strictly newer than what is serving. A git
 * build has no version, so switching a git install to packages takes the
 * newest one. Deleting a release therefore never moves anyone backwards; a
 * rollback is a new package built from a revert (runbook §1s).
 */
export function shouldUpdate(liveVersion, newestVersion) {
  if (!isVersion(newestVersion)) return false;
  if (!isVersion(liveVersion)) return true;
  return compareVersions(newestVersion, liveVersion) > 0;
}

/**
 * Where this install takes updates from. The policy says so when it has a
 * `source`; an older policy file (or one a writer rewrote without the field)
 * falls back to what the install IS: a package takes packages, a git clone
 * builds from git. So no existing install changes path unless its owner does.
 */
export function updateSourceOf(policySource, packaged) {
  if (UPDATE_SOURCES.includes(policySource)) return policySource;
  return packaged ? "release" : "git";
}

/** owner/repo for a GitHub URL (https or ssh), else null. */
export function githubSlug(url) {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}
