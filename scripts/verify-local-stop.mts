// Proves scripts/lib/pg-stop.mjs stops an embedded cluster CLEANLY: pg_ctl
// reports success, postmaster.pid is gone, and the next start of the same
// data directory does not replay WAL. embedded-postgres's own stop() fails all
// three on Windows, and can strand an io_worker that keeps the port bound
// (see the header of pg-stop.mjs), which is what left local:restore's cluster
// unstartable on 2026-09-25.
//
// Gated on embedded-postgres availability with a loud SKIP, same as
// verify-pg-copy.mts. Uses an OS-assigned port and a temp directory.
//
// Run: npx tsx scripts/verify-local-stop.mts
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmDirBestEffort } from "../supervisor/rm-dir.mjs";
import { freePorts } from "./lib/free-port.mjs";
import { pgCtlPath, stopCluster } from "./lib/pg-stop.mjs";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  let EmbeddedPostgres: new (opts: object) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
  try {
    EmbeddedPostgres = (await import("embedded-postgres")).default;
  } catch {
    console.log("\nSKIP  verify-local-stop: embedded-postgres unavailable (needs the platform binaries, npm ci).");
    return;
  }
  const requireFromRepo = createRequire(import.meta.url);
  check("pg_ctl is found beside the bundled postgres binary", pgCtlPath(requireFromRepo) !== null);

  const dir = mkdtempSync(join(tmpdir(), "ledgr-pgstop-"));
  const [port] = await freePorts(1);
  const logs: string[] = [];
  const cluster = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    // Same flags as every runtime cluster (verify-setup.mts asserts them).
    initdbFlags: ["--encoding=UTF8", "--locale-provider=icu", "--icu-locale=en-US", "--locale=C"],
    onLog: (m: string) => logs.push(m),
  });
  try {
    try {
      await cluster.initialise();
      await cluster.start();
    } catch (err) {
      console.log(`SKIP  verify-local-stop: embedded-postgres could not start (${err instanceof Error ? err.message : err})`);
      return;
    }
    const clean = await stopCluster(cluster, dir, requireFromRepo);
    check("stopCluster reports a clean pg_ctl stop", clean);
    check("postmaster.pid is removed by the clean stop", !existsSync(join(dir, "postmaster.pid")));

    logs.length = 0;
    await cluster.start();
    check(
      "the next start does not replay WAL (no 'not properly shut down')",
      !logs.some((m) => m.includes("not properly shut down")),
      logs.filter((m) => m.includes("LOG:")).map((m) => m.trim().slice(0, 80)).join(" | ")
    );
    check("second clean stop", await stopCluster(cluster, dir, requireFromRepo));
  } finally {
    const err = rmDirBestEffort(dir);
    if (err) console.log(`NOTE  temp cluster dir left behind (still in use): ${dir}`);
  }
}

await main();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
