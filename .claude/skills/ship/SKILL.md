---
name: ship
description: Take finished Ledgr work from a local branch to merged on main — run CI, open the PR, check the per-PR upkeep, merge when CI is green. Use when the user says /ship, "ship it", "merge this", "open the PR and merge", or asks to get the current branch onto main.
---

# /ship

The process is: **branch, PR, green CI, merge.** That is the whole thing (ADR-269).

No heads-ups, no acks, no waiting, no gates. Nobody announces work before merging it
and nobody waits for a reply. If a merge turns out wrong, revert it.

## Before you start

- **Never commit to `main`.** If `git branch --show-current` says `main`, branch first.
- **Every merge goes through a PR.** No direct pushes to `main`, no local merges.

## 1. CI has to be green

Run it locally before pushing:

```
npm run ci
```

That is typecheck, lint, build, and `verify:ci`. If it fails, fix it. Do not push red
and wait for GitHub to tell you the same thing.

## 2. Write the PR description for a reader who wasn't there

The PR is the record. It carries the reasoning a reviewer or a future session would
want: what changed, why, what you considered and rejected, anything surprising. This
replaces the heads-up, the ack, and most of what used to become an ADR.

```
gh pr create --title "..." --body "..."
```

## 3. Print the overlap, do not stop for it

Look at what the other builder has touched recently and **print it**:

```
git log origin/main --since="2 weeks ago" --name-only --pretty=format:"%an" | sort -u
```

Say plainly if you are in the same files as their recent work. That is useful to know.
It is **not** a gate and it never blocks the merge.

## 4. Upkeep, in this PR

Ask these, then act:

- **Runbook** — did this change how the thing is operated, restored, deployed, or
  fixed? Update `runbook.md` in this PR. Every time.
- **User guide** — *can the owner now do something they couldn't, or reach something
  somewhere new?* If yes, update `src/lib/mcp/user-guide.ts` in this PR. Every time.
  A refactor, bug fix, or perf change does not move the guide (ADR-189).
- **ADR** — only if the choice is **hard to undo or changes what something means**: a
  migration, the canonical body format, an API change that breaks an existing caller,
  one of the nine principles, or a reversal of an earlier ADR. That is a few a month,
  not a few a day. Write the entry in `decisions.md` as part of the work; never stop,
  ask, or wait for one. Everything else lives in the PR description.

## 5. Bookkeeping, once per batch

`next_steps.md` and `roadmap.md` update when something lands, not on every push. Once
per batch of work is right, not once per slice.

## 6. Merge

Wait for CI green on the PR, then:

```
gh pr merge --squash
```

## Migrations

Additive and reversible: add a column, then backfill; never destroy or rewrite live
owner data in a migration. That rule is why none of the above needs a gate in front of
it. A migration merges like anything else.
