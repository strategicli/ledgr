// The Tailscale helper, run by the supervisor (the Tailscale module, ADR-276).
//
// The helper (tailnet/main.go) joins the owner's tailnet as its own machine and
// serves this install over HTTPS there. This file downloads it, checks it, runs
// it like Postgres, restarts it when it dies, and stops it on shutdown.
//
// WHO DECIDES IT RUNS: the app, never a config file (ADR-222). Two switches,
// both in the app, both must be on: the module (per owner, Build → Modules) and
// this machine's own switch (`tailscale:enabled` in job_state, never synced).
// The supervisor asks the app GET /api/machine/tailscale, which answers both at
// once, every minute and whenever the app drops the `tailscale-requested`
// signal file (Connect, Disconnect). Same signal-file door as Update and Startup.
//
// The pure half (paths, platform choice, checksum, status parsing) is exported
// on its own so scripts/verify-supervisor.mts can check it with no network.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { rmDirRetry } from "./rm-dir.mjs";

// ── Pure ─────────────────────────────────────────────────────────────────────

/** The pinned helper: version, where its release lives, and each file's sha256. */
export function loadTailnetRelease(text) {
  const v = JSON.parse(text);
  if (!v || typeof v.version !== "string" || typeof v.repo !== "string" || !v.sha256) {
    throw new Error("tailnet/release.json needs version, repo and sha256");
  }
  return v;
}

/** The release file for this computer, or null when we do not build one. */
export function tailnetAsset(platform, arch) {
  const os = { win32: "windows", darwin: "darwin", linux: "linux" }[platform];
  const cpu = { x64: "amd64", arm64: "arm64" }[arch];
  if (!os || !cpu) return null;
  return `ledgr-tailnet-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
}

export function tailnetDownloadUrl(release, asset) {
  return `https://github.com/${release.repo}/releases/download/tailnet-v${release.version}/${asset}`;
}

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** True only for an exact match against the pinned checksum. */
export function checksumOk(buf, expected) {
  return typeof expected === "string" && /^[0-9a-f]{64}$/.test(expected) && sha256Hex(buf) === expected;
}

/** `ledgr-<machine name>`, in the letters a tailnet name allows. */
export function tailnetHostname(machine, override) {
  const clean = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  if (override && clean(override)) return clean(override);
  const m = clean(machine);
  return m ? clean(`ledgr-${m}`) : "ledgr";
}

export const TAILNET_STATES = ["off", "starting", "needs-login", "running", "error", "signed-out"];

/** Tolerant read of the status file. Anything unusable is null ("no status"). */
export function parseTailnetStatus(text) {
  try {
    const v = JSON.parse(text);
    if (!v || !TAILNET_STATES.includes(v.state)) return null;
    const str = (x) => (typeof x === "string" && x ? x : null);
    return {
      state: v.state,
      authUrl: str(v.authUrl),
      dnsName: str(v.dnsName),
      url: str(v.url),
      message: str(v.message),
      at: str(v.at),
    };
  } catch {
    return null;
  }
}

export function serializeTailnetStatus(s) {
  return JSON.stringify({ ...s, at: new Date().toISOString() }, null, 2) + "\n";
}

/** The signal file's body: `{"logout": true}` for Disconnect, anything else a re-check. */
export function parseTailnetRequest(text) {
  try {
    return { logout: JSON.parse(text)?.logout === true };
  } catch {
    return { logout: false };
  }
}

export function tailnetPaths(dataDir) {
  const root = join(dataDir, "tailscale");
  return {
    root,
    state: join(root, "state"), // this node's keys: never logged, never copied
    bin: join(root, "bin"),
    status: join(root, "status.json"),
    signal: join(dataDir, "tailscale-requested"),
  };
}

// ── The shell ────────────────────────────────────────────────────────────────

/**
 * @param {{ dataDir: string, appPort: number, log: Function, nextBackoffMs: Function,
 *           askApp: () => Promise<boolean | null> }} o
 *   askApp answers "should the helper run?", or null when the app did not answer
 *   (then nothing changes).
 */
export function createTailnet(o) {
  const paths = tailnetPaths(o.dataDir);
  const release = loadTailnetRelease(readFileSync(new URL("../tailnet/release.json", import.meta.url), "utf8"));
  const asset = tailnetAsset(process.platform, process.arch);
  const name = tailnetHostname(hostname(), process.env.LEDGR_TAILNET_HOSTNAME);
  let child = null;
  let crashes = 0;
  let wanted = false;
  let busy = false;
  let stopping = false;
  let retry = null;

  const status = (s) => {
    try {
      mkdirSync(paths.root, { recursive: true });
      writeFileSync(paths.status, serializeTailnetStatus(s), "utf8");
    } catch (err) {
      o.log("could not write the tailscale status", { error: String(err) });
    }
  };
  const currentState = () => {
    try {
      return parseTailnetStatus(readFileSync(paths.status, "utf8"))?.state ?? null;
    } catch {
      return null;
    }
  };

  /** The helper for this platform, downloaded and checked. Null on any failure, reported. */
  async function binary() {
    if (!asset || !release.sha256[asset]) {
      status({ state: "error", message: `There is no Tailscale helper for this computer (${process.platform}/${process.arch}).` });
      return null;
    }
    const file = join(paths.bin, `${release.version}-${asset}`);
    // Re-checked on every start, not only after download: a file changed on
    // disk is refused the same way a bad download is.
    if (existsSync(file) && checksumOk(readFileSync(file), release.sha256[asset])) return file;
    const url = tailnetDownloadUrl(release, asset);
    o.log("downloading the tailscale helper", { url });
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!checksumOk(buf, release.sha256[asset])) {
        throw new Error(`checksum mismatch (got ${sha256Hex(buf).slice(0, 12)}…); refusing to run it`);
      }
      mkdirSync(paths.bin, { recursive: true });
      writeFileSync(`${file}.part`, buf, { mode: 0o755 });
      renameSync(`${file}.part`, file);
      return file;
    } catch (err) {
      const detail = String(err?.message ?? err);
      o.log("tailscale helper download FAILED", { detail });
      status({ state: "error", message: `Could not download the Tailscale helper: ${detail}` });
      return null;
    }
  }

  async function start() {
    const bin = await binary();
    if (!bin || !wanted || child) return;
    mkdirSync(paths.state, { recursive: true });
    const c = spawn(
      bin,
      ["-dir", paths.state, "-hostname", name, "-target", `http://127.0.0.1:${o.appPort}`, "-status", paths.status],
      {
        stdio: ["pipe", "inherit", "inherit"],
        windowsHide: true,
        // No log upload to Tailscale's servers from this node.
        env: { ...process.env, TS_NO_LOGS_NO_SUPPORT: "true" },
      }
    );
    child = c;
    const startedAt = Date.now();
    o.log("tailscale helper started", { pid: c.pid, hostname: name });
    c.on("error", (err) => o.log("tailscale helper could not start", { error: String(err) }));
    c.on("exit", (code, sig) => {
      if (child !== c) return;
      child = null;
      if (stopping || !wanted) return;
      crashes = Date.now() - startedAt > 60_000 ? 0 : crashes + 1;
      const wait = o.nextBackoffMs(crashes);
      o.log("tailscale helper exited; restarting", { code, sig, inMs: wait });
      if (code !== 0 && currentState() === "running") {
        status({ state: "starting", message: "The Tailscale helper stopped and is restarting." });
      }
      retry = setTimeout(() => void start(), wait);
      retry.unref?.();
    });
  }

  /** Close its stdin (the helper's stop signal); force it after 10s. */
  function stop() {
    clearTimeout(retry);
    const c = child;
    child = null;
    if (!c || c.exitCode !== null) return Promise.resolve();
    return new Promise((done) => {
      const force = setTimeout(() => c.kill("SIGKILL"), 10_000);
      c.once("exit", () => {
        clearTimeout(force);
        done();
      });
      c.stdin?.end();
    });
  }

  /** Disconnect: sign the node out of the tailnet, then forget its keys. */
  async function logout() {
    await stop();
    const file = asset ? join(paths.bin, `${release.version}-${asset}`) : null;
    if (existsSync(paths.state) && file && existsSync(file)) {
      const r = spawnSync(file, ["-dir", paths.state, "-hostname", name, "-logout"], {
        timeout: 45_000,
        windowsHide: true,
        encoding: "utf8",
        env: { ...process.env, TS_NO_LOGS_NO_SUPPORT: "true" },
      });
      o.log(r.status === 0 ? "tailscale node signed out" : "tailscale sign-out did not finish", {
        code: r.status,
        detail: (r.stderr ?? "").trim().split("\n").pop(),
      });
    }
    rmDirRetry(paths.state);
    status({ state: "signed-out" });
  }

  async function reconcile(reason) {
    if (busy || stopping) return;
    busy = true;
    try {
      const want = await o.askApp();
      if (want === null) return;
      if (want !== wanted) o.log(want ? "tailscale switched on" : "tailscale switched off", { reason });
      wanted = want;
      if (wanted && !child) await start();
      else if (!wanted && child) {
        await stop();
        status({ state: "off" });
      } else if (!wanted && !["off", "signed-out", null].includes(currentState())) {
        status({ state: "off" }); // a stale "running" from before a crash
      }
    } finally {
      busy = false;
    }
  }

  // The app's signal file, on the same 2s beat as the others.
  setInterval(() => {
    if (!existsSync(paths.signal) || busy) return;
    let req;
    try {
      req = parseTailnetRequest(readFileSync(paths.signal, "utf8"));
      unlinkSync(paths.signal);
    } catch {
      return; // mid-write; next tick gets it
    }
    void (async () => {
      if (req.logout) {
        busy = true;
        try {
          await logout();
        } catch (err) {
          o.log("tailscale sign-out FAILED", { error: String(err) });
        } finally {
          busy = false;
        }
      }
      await reconcile("signal");
    })();
  }, 2000).unref?.();
  setInterval(() => void reconcile("poll"), 60_000).unref?.();

  return {
    reconcile,
    async shutdown() {
      stopping = true;
      if (child) {
        await stop();
        status({ state: "off" });
      }
    },
  };
}
