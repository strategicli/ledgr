// One-command production release (phase-1 flow, ADR: deploy model / PR #140).
//
// Ordering guarantees the DB is migrated BEFORE the code that needs it goes
// live, and that a red gate can never reach prod:
//
//   1. preflight   — clean working tree + fetch
//   2. ff-merge    — fast-forward the deploy branch to origin/main (code to ship)
//   3. gates + dev — the GitHub CI "check" job must be green on this exact
//                    code, then (only if the release carries a migration)
//                    migrate DEV (canary) and run the core verifies against it;
//                    ABORT on the first failure
//   4. migrate prod — only if the release carries a migration
//   5. push        — push the deploy branch; Vercel auto-deploys
//
// FAST PATH (2026-09-25, "ship in 2 minutes"). Two waits were paying for
// nothing on an ordinary release:
//  - CI ran again on main after the squash merge, and the release waited ~3 min
//    for it. When main's commit holds the SAME TREE (same files, byte for byte)
//    as the PR head CI already passed, that second run can only repeat the first
//    verdict, so the gate accepts the PR head's run. If main moved in between
//    (someone else merged), the trees differ and it waits for main's run, as
//    before.
//  - Dev migrate + core verifies + prod migrate ran even with no migration.
//    They run now only when ./drizzle changed between the deploy branch and
//    main. `--full` runs them regardless.
//
// Why a CI gate instead of local lint + build: CI (.github/workflows/ci.yml:
// typecheck, lint, build, verify:ci) already ran on every commit that reached
// main, so rebuilding here repeated ~minutes of work to learn nothing new.
// `--full` brings the local lint + build back for when GitHub is unavailable.
//
// The ~90 report-only DB suites (`npm run verify:db`) used to run here too. They
// could never block a release, yet they were most of its runtime; run them on
// their own when you want the report.
//
// Stage 3's migrate-dev-first means every migration is applied to the throwaway
// dev branch and exercised by the verifies before it ever touches prod.
//
// Deploy branch defaults to prod-brandon; override with RELEASE_TARGET_BRANCH
// (Tyler: set it to prod-tyler and keep your own .env.production.local).
// Prod credentials come only from .env.production.local (never .env.local).
import { execSync, execFileSync } from "node:child_process";

const TARGET = process.env.RELEASE_TARGET_BRANCH || "prod-brandon";
const REPO = "strategicli/ledgr";
const CI_CHECK = "check"; // the job name in .github/workflows/ci.yml
const FULL = process.argv.includes("--full");
const CORE_VERIFIES = [
  "verify-db.mjs",
  "verify-items.mts",
  "verify-relations.mts",
  "verify-types.mts",
];

const sh = (cmd) => execSync(cmd, { stdio: "inherit" });
const cap = (cmd) => execSync(cmd).toString().trim();
const stage = (n, msg) => console.log(`\n=== [${n}/5] ${msg} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the CI "check" run on `sha` to finish; throw unless it succeeded.
// A run that hasn't appeared yet (main was pushed seconds ago) gets a short
// grace period, then counts as missing.
async function requireGreenCi(sha) {
  const POLL_MS = 15_000;
  const PENDING_LIMIT_MS = 10 * 60_000; // CI takes ~3 min
  const MISSING_LIMIT_MS = 90_000;
  const start = Date.now();
  for (;;) {
    // execFileSync, no shell: gh is a real exe on Windows, and no quoting games.
    const json = execFileSync(
      "gh",
      ["api", `repos/${REPO}/commits/${sha}/check-runs?check_name=${CI_CHECK}&per_page=100`],
      { encoding: "utf8" }
    );
    const runs = JSON.parse(json).check_runs.filter((r) => r.name === CI_CHECK);
    // A re-run leaves the old run behind; the newest one is the verdict.
    const run = runs.sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
    const waited = Date.now() - start;
    if (!run) {
      if (waited > MISSING_LIMIT_MS) {
        throw new Error(`no CI "${CI_CHECK}" run exists for ${sha.slice(0, 7)} (use --full to build locally instead)`);
      }
    } else if (run.status === "completed") {
      if (run.conclusion === "success") {
        console.log(`CI "${CI_CHECK}" passed on ${sha.slice(0, 7)}: ${run.html_url}`);
        return;
      }
      throw new Error(`CI "${CI_CHECK}" concluded ${run.conclusion} on ${sha.slice(0, 7)}: ${run.html_url}`);
    } else if (waited > PENDING_LIMIT_MS) {
      throw new Error(`CI "${CI_CHECK}" still ${run.status} after ${PENDING_LIMIT_MS / 60_000} min: ${run.html_url}`);
    }
    console.log(`CI "${CI_CHECK}" ${run ? run.status : "not started yet"} on ${sha.slice(0, 7)}; checking again in ${POLL_MS / 1000}s`);
    await sleep(POLL_MS);
  }
}

// The commit whose CI verdict stands for main's code: the merged PR's head when
// it has main's exact tree, otherwise main itself.
function ciShaFor(mainSha) {
  try {
    const pulls = JSON.parse(
      execFileSync("gh", ["api", `repos/${REPO}/commits/${mainSha}/pulls`], { encoding: "utf8" })
    );
    const head = pulls.find((p) => p.merged_at)?.head?.sha;
    if (!head) return mainSha;
    const headTree = JSON.parse(
      execFileSync("gh", ["api", `repos/${REPO}/git/commits/${head}`], { encoding: "utf8" })
    ).tree.sha;
    if (headTree === cap(`git rev-parse ${mainSha}^{tree}`)) {
      console.log(`main ${mainSha.slice(0, 7)} has the same files as PR head ${head.slice(0, 7)}; using its CI run`);
      return head;
    }
  } catch {
    // Any lookup failure falls back to the safe, slower gate.
  }
  return mainSha;
}

let origBranch = "HEAD";
try {
  origBranch = cap("git rev-parse --abbrev-ref HEAD");

  stage(1, "preflight: clean working tree + fetch");
  if (cap("git status --porcelain")) {
    throw new Error("working tree is dirty — commit or stash before releasing");
  }
  sh("git fetch origin --quiet");
  // Decided before the fast-forward: what does main add that prod doesn't have?
  const hasMigration =
    FULL || cap(`git diff --name-only origin/${TARGET} origin/main -- drizzle`) !== "";

  stage(2, `fast-forward ${TARGET} to origin/main`);
  sh(`git checkout ${TARGET}`);
  // --ff-only: the deploy branch is a pure pointer to main; if this fails,
  // someone committed to it directly and that must be resolved by hand.
  sh("git merge --ff-only origin/main");

  stage(3, FULL
    ? "gates: local lint + build (--full), then migrate DEV (canary) + core verifies"
    : hasMigration
      ? "gates: CI green on this code, then migrate DEV (canary) + core verifies"
      : "gates: CI green on this code (no migration, database steps skipped)");
  if (FULL) {
    sh("npm run lint");
    sh("npm run build");
  } else {
    await requireGreenCi(ciShaFor(cap("git rev-parse origin/main")));
  }
  if (hasMigration) {
    sh("npm run db:migrate"); // dev, via .env.local
    for (const v of CORE_VERIFIES) {
      sh(`node --env-file-if-exists=.env.local --import tsx scripts/${v}`);
    }
  }

  stage(4, hasMigration ? "migrate PROD" : "migrate PROD: skipped, no migration in this release");
  if (hasMigration) sh("npm run db:migrate:prod"); // prod, via .env.production.local

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
