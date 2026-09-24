// Run every verify script that needs NO database and NO running server.
//
// Why this exists: `main` failed to build twice in 2026-08 — an extra named
// export in a page file, and an `unknown` passed to a `string` param — and both
// merged green, because nothing ran `tsc` or `next build` before a merge. The
// same gap had quietly broken SIX verify scripts (stale expectations for the
// longform note canvas, the `/dashboards/<id>` chrome rule, the second
// machine-token helper, and a pre-palette red hex), none of which anyone saw,
// because nothing ran them either. A check nobody runs is not a check.
//
// Discovery over an allowlist, deliberately: a NEW pure verify script joins CI
// the moment it lands, with nobody remembering to register it. That is the exact
// failure this file exists to prevent, so the mechanism must not reintroduce it.
//
// The DB/server-backed suites (verify-mcp*, verify-items, verify-structures, …)
// need real credentials, which CI has no business holding, so they are excluded
// here and run with --backend instead (npm run verify:db) against the DEV
// database. `release:prod` runs them at stage 3, right after it migrates dev.
//
// Why that matters: before 2026-09-22 only FOUR of the ~90 DB-backed scripts ran
// anywhere automatic (release:prod's hard gates), so ~15k lines of guard code
// only ever ran if someone typed the command. A check nobody runs is not a
// check — the same sentence this file already opens with, applied to itself.
//
//   node scripts/verify-ci.mjs            # everything pure
//   node scripts/verify-ci.mjs --backend  # the DB-backed suites, against dev
//   node scripts/verify-ci.mjs --list     # just show the classification
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const DIR = "scripts";

// A script is DB/server-backed if it reaches for the db client, a connection
// string, the Neon driver, or a running localhost. Kept as one regex so the
// classification is inspectable in one place, and mirrored in the comment above.
const NEEDS_BACKEND =
  /from "\.\.\/src\/db|@\/db|getDb|localhost:3000|DATABASE_URL|neon\(/;

const all = readdirSync(DIR)
  .filter((f) => /^verify-.*\.(mts|mjs)$/.test(f))
  .sort();

// A script that drives a RUNNING peer (its own app server + its own cluster,
// named by PEER_URL / PEER_DB) can run in neither mode: CI has no server and
// release:prod has no peer. It exits before testing anything, so running it
// only ever printed a FAIL that said nothing. Listed, never run here; the
// manual step is in supervisor/README.md.
const NEEDS_PEER = /process\.env\.PEER_DB/;

const pure = [];
const backend = [];
const manual = [];
for (const f of all) {
  const src = readFileSync(join(DIR, f), "utf8");
  (NEEDS_PEER.test(src) ? manual : NEEDS_BACKEND.test(src) ? backend : pure).push(f);
}

if (process.argv.includes("--list")) {
  console.log(`PURE (${pure.length}, run in CI):`);
  for (const f of pure) console.log(`  ${f}`);
  console.log(`\nBACKEND (${backend.length}, local/manual only):`);
  for (const f of backend) console.log(`  ${f}`);
  console.log(`\nMANUAL (${manual.length}, need a running peer, never run here):`);
  for (const f of manual) console.log(`  ${f}`);
  process.exit(0);
}

// --backend runs the OTHER list, against whatever DATABASE_URL is in scope
// (.env.local — the dev branch). Same runner, same reporting, so the two halves
// can't drift apart.
const BACKEND_MODE = process.argv.includes("--backend");
const suite = BACKEND_MODE ? backend : pure;
const label = BACKEND_MODE ? "DB-backed" : "pure";

if (BACKEND_MODE && !process.env.DATABASE_URL) {
  console.log(
    "--backend needs DATABASE_URL (dev). Run it through `npm run verify:db`, " +
      "which loads .env.local, and never point it at production."
  );
  process.exit(1);
}

console.log(
  BACKEND_MODE
    ? `Running ${backend.length} DB-backed verify scripts against the dev database.\n`
    : `Running ${pure.length} pure verify scripts (${backend.length} DB/server-backed ones skipped).\n`
);

// DATABASE_URL is cleared rather than merely absent: a developer running this
// locally has one in .env.local, and a script that quietly depends on the DB
// while dodging the regex above must fail HERE, not mysteriously in CI.
const env = BACKEND_MODE ? { ...process.env } : { ...process.env, DATABASE_URL: "" };

// Spawn tsx's own entry with this node, rather than shelling out to `npx tsx`
// once per script. npx re-resolves the package on every single call, which on
// Windows cost 4719ms per script against 1194ms for the direct spawn
// (measured; across 67 scripts that is minutes, not milliseconds). It also
// needed a shell on win32 to find the .cmd shim, which spends a cmd.exe per
// spawn and earns a DEP0190 warning for passing args through one. Same tsx,
// same argv, no shell. verify-setup.mts guards it, since a regression here is
// silent: the suite still passes, just far slower.
const TSX = createRequire(import.meta.url).resolve("tsx/cli");

const failed = [];
for (const f of suite) {
  const res = spawnSync(process.execPath, [TSX, join(DIR, f)], {
    encoding: "utf8",
    env,
  });
  const ok = res.status === 0;
  if (!ok) failed.push({ f, out: `${res.stdout ?? ""}${res.stderr ?? ""}` });
  console.log(`${ok ? "PASS" : "FAIL"}  ${f}`);
}

if (failed.length) {
  // Print the full output of failures only. A wall of passing output buries the
  // one thing the reader came for.
  for (const { f, out } of failed) {
    console.log(`\n──────── ${f} ────────`);
    // The failing assertions, plus a tail for a crash that printed no FAIL line.
    const lines = out.split("\n");
    const relevant = lines.filter((l) => /^FAIL|FAILURE|Error|error/.test(l));
    console.log((relevant.length ? relevant : lines.slice(-25)).join("\n"));
  }
  console.log(`\n${failed.length} of ${suite.length} ${label} verify scripts FAILED.`);
  process.exit(1);
}

console.log(`\nAll ${suite.length} ${label} verify scripts passed.`);
