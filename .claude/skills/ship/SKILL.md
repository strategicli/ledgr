---
name: ship
description: Take finished Ledgr work from a local branch to merged on main AND released to prod-brandon in about 2 minutes — push, open the PR, wait for CI, merge, release. Use when the user says /ship, "ship it", "go", "merge this", "push to main and release", or asks to get the current branch onto main or into production.
---

# /ship

The process is: **branch, PR, green CI, merge, release.** That is the whole thing
(ADR-269). Target: about **2 minutes** from "go" to fresh code on `main` and on
`prod-brandon` (Brandon, 2026-09-25).

No heads-ups, no acks, no waiting, no gates beyond CI. If a merge turns out wrong,
revert it.

## Before you start

- **Never commit to `main`.** If `git branch --show-current` says `main`, branch first.
- **Every merge goes through a PR.** No direct pushes to `main`, no local merges.
- **Bring the branch up to date with `main` before pushing** (`git fetch` +
  merge/rebase `origin/main`). An up-to-date branch is what lets the release reuse
  the PR's CI run instead of waiting ~1.5 min for a second one on `main`.

## 1. Don't re-run CI locally

Do **not** run `npm run ci` before pushing. GitHub runs the identical check on the
PR (typecheck, lint, build, and the pure verify suites, in parallel, ~1.5 min).
Running it locally too is what used to make a ship take 15 minutes. Run a single
targeted check locally only when you need its answer while working (e.g. the
verify script for the code you changed).

## 2. Upkeep, in the same PR

Ask these, then act, before pushing:

- **Runbook** — did this change how the thing is operated, restored, deployed, or
  fixed? Update `runbook.md`. Every time.
- **User guide** — *can the owner now do something they couldn't, or reach something
  somewhere new?* If yes, update `src/lib/mcp/user-guide.ts`. A refactor, bug fix,
  or perf change does not move the guide (ADR-189).
- **ADR** — only if the choice is **hard to undo or changes what something means**: a
  migration, the canonical body format, an API change that breaks an existing caller,
  one of the nine principles, or a reversal of an earlier ADR. Write the entry in
  `decisions.md`; never stop, ask, or wait for one.
- **Bookkeeping** — `next_steps.md` / `roadmap.md` once per batch, not per slice.

## 3. Push and open the PR

The PR description is the record: what changed, why, what you considered and
rejected, anything surprising, written for a reader who wasn't there.

```
git push -u origin <branch>
gh pr create --title "..." --body "..."
```

Print the other builder's recent overlap in one line (`git log origin/main
--since="2 weeks ago" --name-only --pretty=format:"%an" -- <dirs you touched>`).
It is information, never a gate.

## 4. Wait for CI, then merge

```
gh pr checks <n> --watch --interval 15
gh pr merge <n> --squash --delete-branch
```

Only the **`check`** result matters. **Expected noise — do not investigate or report
it:** `Vercel – devledgr: Deployment was blocked` shows as a failure on every PR and
every release. Previews on that project are switched off to save the Vercel build
quota (runbook §1j-1). Ignore it.

If `check` fails, read the failing job's log, fix, push, and wait again.

## 5. Release to prod-brandon

```
git checkout main && git pull
npm run release:prod
```

On an ordinary change this takes seconds: the release reuses the PR's green CI run
when `main` holds the identical files, and skips every database step when the
release adds no migration. With a migration it migrates the dev database, runs the
core database verifies, migrates prod, then pushes — as it always has.

## 6. Report once, then stop

When `release:prod` prints `✅ Released`, tell Brandon it's on `main` and
`prod-brandon`, in a few lines. **Do not** watch Vercel, poll `/health`, or check
whether the laptop hub picked it up: Vercel builds on its own, and Brandon presses
**Update** in the app when he wants the hub current.

## Migrations

Additive and reversible: add a column, then backfill; never destroy or rewrite live
owner data in a migration. That rule is why none of the above needs a gate in front of
it. A migration merges like anything else.
