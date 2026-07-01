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
