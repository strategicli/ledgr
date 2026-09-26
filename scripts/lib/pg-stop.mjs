// Stop an embedded-postgres cluster the way Postgres wants to be stopped.
//
// embedded-postgres's own `stop()` is `taskkill /f /t` on Windows: a kill,
// not a shutdown. Two costs. Every next start replays WAL ("database system
// was not properly shut down"). Worse, and the reason this file exists
// (2026-09-25, found testing PR #447): the postmaster sometimes respawns an
// `io_worker` child in the instant between taskkill reaching the children and
// reaching it. That orphan has no parent, inherited the listening socket, and
// so keeps the port bound; the next start of the same cluster fails with
// "could not bind", and nothing points at the culprit. Reproduced on a scratch
// cluster: one orphan per ~5 stops with `stop()`, zero in 6/6 with pg_ctl.
//
// `pg_ctl stop -m fast` is the ordinary answer, and pg_ctl ships beside the
// postgres binary embedded-postgres already resolved. The supervisor has done
// this since ADR-211 (supervisor/ledgr-supervisor.mjs, stopPostgresGracefully);
// this is the same move for the scripts that own a cluster only briefly:
// local-restore, local-setup, local-snapshot, and the verify suites.
//
// After a clean pg_ctl stop the postmaster is already gone, so `cluster.stop()`
// must NOT be called: it waits for an 'exit' event that has already fired and
// never returns. It stays as the fallback when pg_ctl is missing or times out.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Path to the bundled pg_ctl, or null when the platform package is missing. */
export function pgCtlPath(requireFromRepo) {
  const pkg = `${process.platform === "win32" ? "windows" : process.platform}-${
    process.arch === "arm64" ? "arm64" : "x64"
  }`;
  try {
    // resolve() lands on the package's dist entry; binaries are in native/bin.
    const bin = dirname(dirname(requireFromRepo.resolve(`@embedded-postgres/${pkg}`)));
    const pgCtl = join(bin, "native", "bin", process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
    return existsSync(pgCtl) ? pgCtl : null;
  } catch {
    return null;
  }
}

/**
 * Shut the cluster at `pgDir` down cleanly; fall back to embedded-postgres's
 * kill only if pg_ctl cannot. Returns true when the stop was clean.
 * @param {{ stop(): Promise<void> }} cluster the EmbeddedPostgres instance
 * @param {string} pgDir its databaseDir
 * @param {NodeJS.Require} requireFromRepo a require anchored at the repo's package.json
 */
export async function stopCluster(cluster, pgDir, requireFromRepo) {
  const pgCtl = pgCtlPath(requireFromRepo);
  if (pgCtl) {
    // -w waits; -t bounds the wait so a wedged cluster cannot hang the script.
    const res = spawnSync(pgCtl, ["stop", "-D", pgDir, "-m", "fast", "-w", "-t", "30"], { encoding: "utf8" });
    if (res.status === 0) return true;
    console.log(`pg_ctl stop did not complete; falling back to a forced stop: ${(res.stderr || res.stdout || "").trim()}`);
  }
  await cluster.stop().catch(() => {});
  return false;
}
