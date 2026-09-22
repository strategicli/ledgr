// One-command production release (phase-1 flow, ADR: deploy model / PR #140).
//
// Ordering guarantees the DB is migrated BEFORE the code that needs it goes
// live, and that a red gate can never reach prod:
//
//   1. preflight   — clean working tree + fetch
//   2. ff-merge    — fast-forward the deploy branch to origin/main (code to ship)
//   3. dev + gates — migrate DEV (canary), then lint, build, core verifies
//                    against dev; ABORT on the first failure
//   4. migrate prod
//   5. push        — push the deploy branch; Vercel auto-deploys
//
// Steps 3's migrate-dev-first means every migration is applied to the throwaway
// dev branch and exercised by the verifies before it ever touches prod.
//
// Deploy branch defaults to prod-brandon; override with RELEASE_TARGET_BRANCH
// (Tyler: set it to prod-tyler and keep your own .env.production.local).
// Prod credentials come only from .env.production.local (never .env.local).
import { execSync } from "node:child_process";

const TARGET = process.env.RELEASE_TARGET_BRANCH || "prod-brandon";
const CORE_VERIFIES = [
  "verify-db.mjs",
  "verify-items.mts",
  "verify-relations.mts",
  "verify-types.mts",
];

const sh = (cmd) => execSync(cmd, { stdio: "inherit" });
const cap = (cmd) => execSync(cmd).toString().trim();
const stage = (n, msg) => console.log(`\n=== [${n}/5] ${msg} ===`);

let origBranch = "HEAD";
try {
  origBranch = cap("git rev-parse --abbrev-ref HEAD");

  stage(1, "preflight: clean working tree + fetch");
  if (cap("git status --porcelain")) {
    throw new Error("working tree is dirty — commit or stash before releasing");
  }
  sh("git fetch origin --quiet");

  stage(2, `fast-forward ${TARGET} to origin/main`);
  sh(`git checkout ${TARGET}`);
  // --ff-only: the deploy branch is a pure pointer to main; if this fails,
  // someone committed to it directly and that must be resolved by hand.
  sh("git merge --ff-only origin/main");

  stage(3, "migrate DEV (canary), then gates: lint, build, core verifies");
  sh("npm run db:migrate"); // dev, via .env.local
  sh("npm run lint");
  sh("npm run build");
  for (const v of CORE_VERIFIES) {
    sh(`node --env-file-if-exists=.env.local --import tsx scripts/${v}`);
  }

  // The rest of the DB-backed suites, against the dev branch we just migrated.
  // REPORT-ONLY on purpose: until 2026-09-22 only the four above ran anywhere
  // automatic, so ~15k lines of guard code had gone unexercised for months and
  // some of it is certainly stale. Aborting a release on a guard nobody has run
  // since August would punish the release for the backlog. It prints what fails
  // instead; a script that fails here either gets fixed or deleted, and one that
  // proves itself graduates into CORE_VERIFIES above.
  try {
    sh("npm run verify:db");
  } catch {
    console.log(
      "\n^^ DB-backed verifies reported failures (NOT blocking this release).\n" +
        "   Fix or delete each one: a guard that nobody trusts is worse than none.\n"
    );
  }

  stage(4, "migrate PROD");
  sh("npm run db:migrate:prod"); // prod, via .env.production.local

  stage(5, `push ${TARGET} -> Vercel deploys`);
  sh(`git push origin ${TARGET}`);

  sh(`git checkout ${origBranch}`);
  console.log(
    `\n✅ Released: ${TARGET} pushed, Vercel is building. Restored to ${origBranch}.`
  );
} catch (err) {
  console.error(`\n❌ Release aborted: ${err.message || err}`);
  console.error("Prod was NOT deployed. Restoring your branch.");
  try {
    if (cap("git rev-parse --abbrev-ref HEAD") !== origBranch) {
      sh(`git checkout ${origBranch}`);
    }
  } catch {}
  process.exit(1);
}
