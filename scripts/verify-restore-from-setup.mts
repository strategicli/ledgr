// Verification for "Restore from a backup" on the first-run page (ADR-282).
//
// What has to hold:
//   1. The app and the supervisor name the same files. They live in different
//      languages and processes; a path that drifts is a restore that silently
//      never runs.
//   2. A leftover request never restores on some later restart: only a fresh
//      one counts, and an unreadable one never does.
//   3. The owner is told the restore's own error line, not a log dump.
//   4. The restore runs where nothing else can use the cluster: after Postgres
//      stops and before the lock is released, and only on a restart.
//   5. The upload route sits outside the proxy (which cuts bodies at 10MB).
//
// Run: npx tsx scripts/verify-restore-from-setup.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  RESTORE_REQUEST_MAX_AGE_MS,
  restoreErrorLine,
  restoreRequestFresh,
  restoreResultPath,
  restoreSignalPath,
  restoreUploadPath,
} from "../supervisor/lib.mjs";

let failed = 0;
function ok(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}\n  ${err instanceof Error ? err.message : err}`);
  }
}

// Read, not imported: the app half imports the database client.
const app = readFileSync("src/lib/first-run.ts", "utf8");

ok("app and supervisor name the same files", () => {
  assert.match(app, new RegExp(`RESTORE_REQUEST_FILE = "${basename(restoreSignalPath("D"))}"`));
  assert.match(app, new RegExp(`RESTORE_RESULT_FILE = "${basename(restoreResultPath("D")).replace(".", "\\.")}"`));
  const up = restoreUploadPath("D");
  assert.match(app, new RegExp(`RESTORE_UPLOAD = join\\("${basename(dirname(up))}", "${basename(up).replace(".", "\\.")}"\\)`));
});

ok("only a fresh request counts", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const at = (ms: number) => JSON.stringify({ at: new Date(now - ms).toISOString() });
  assert.equal(restoreRequestFresh(at(0), now), true);
  assert.equal(restoreRequestFresh(at(RESTORE_REQUEST_MAX_AGE_MS - 1000), now), true);
  assert.equal(restoreRequestFresh(at(RESTORE_REQUEST_MAX_AGE_MS + 1000), now), false);
  assert.equal(restoreRequestFresh(at(-10 * 60_000), now), false, "a request from the future");
  assert.equal(restoreRequestFresh("", now), false);
  assert.equal(restoreRequestFresh("{}", now), false);
  assert.equal(restoreRequestFresh("not json", now), false);
});

ok("the owner sees the restore's last error line", () => {
  assert.equal(restoreErrorLine("Restoring…\nERROR: first\nnoise\nERROR: pg_restore failed\n"), "pg_restore failed");
  assert.match(restoreErrorLine("no error lines"), /without saying why/);
});

ok("the restore runs between Postgres stopping and the lock being released, on a restart only", () => {
  const sup = readFileSync("supervisor/ledgr-supervisor.mjs", "utf8");
  const body = sup.slice(sup.indexOf("async function shutdown("));
  const stopped = body.indexOf('log("postgres stopped"');
  const restore = body.indexOf("restoreIfAsked()");
  const release = body.indexOf("releaseLock()");
  assert.ok(stopped > 0 && restore > stopped && release > restore, "order is wrong");
  assert.match(body.slice(stopped, restore), /if \(restartAfterShutdown\)/);
});

ok("the package carries local-restore and what it loads", () => {
  const pkg = readFileSync("scripts/package.mjs", "utf8");
  for (const f of ["local-restore.mjs", "local-setup-lib.mjs", "lib/pg-copy.mjs", "lib/pg-stop.mjs"]) assert.ok(pkg.includes(`"${f}"`), f);
});

ok("the upload route is outside the proxy", () => {
  assert.match(readFileSync("src/proxy.ts", "utf8"), /\(\?!health\|_next\|files\/local\/\|restore-upload\|/);
});

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nverify-restore-from-setup: all checks passed");
