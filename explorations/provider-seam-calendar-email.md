# Exploration: provider seam for calendar + email-in (Microsoft / Google / iCloud)

**Status:** parked, open for Brandon + Tyler. Core (provider interfaces are a both-agree area per CLAUDE.md "Building together"), so it lands as an ADR before it builds. Likely built and proven in Tyler's instance first (he needs Google), then adopted.
**Source:** cherry-picked from Tyler's `tyler/additions-for-review` branch (`ty-additions/integrations-savor-atlas.md`, `ty-additions/FOR-BRANDON-approach-diff.md` #6).

## The idea

CLAUDE.md and PRD §6.1 already keep three cloud dependencies behind thin interfaces (storage today; auth and scheduler flagged to follow). This extends the same discipline to **calendar** and **email-in**, so the integration that pulls events and inbound mail is an adapter, not hard-coded Microsoft Graph.

| Concern | Brandon's adapter | Tyler's adapter |
|---|---|---|
| Sign-in | Microsoft (Entra/Graph) | Google |
| Calendar | Graph | Google Calendar |
| Email-in | Outlook folder via Graph `messages/delta` | Gmail label/query (or skip) |
| Export/backup | OneDrive | iCloud / Google Drive / R2 |
| Storage | R2 | R2 (same) |
| Scheduler | GitHub Actions to authed endpoints | same |

## Why it earns consideration

- It directly answers the PRD's open question 7 ("do non-Microsoft users need Google equivalents"). Building the seam is what makes Ledgr genuinely generalizable rather than Brandon-shaped.
- The work lands in Tyler's instance first because he actually runs on Google + iCloud, so he builds and proves the answer to Q7 as a side effect of needing it.
- It composes with the existing provider-seam pattern: the calendar matcher and email-in plumbing already exist; this only swaps what sits behind them.

## What to decide together

- The exact interface shape for a calendar provider (event fetch, delta/changed-since, attendee resolution) and an email-in provider (folder/label query, delta, attachment handling), so both adapters satisfy the same contract.
- Whether email-in is required for Tyler at all (he may skip Gmail ingestion), which affects how much of the seam is built now vs deferred.
- Keep incremental-sync discipline (delta queries, never full re-pulls) in the interface itself so no adapter can violate it.

## Why it is core

Provider interfaces (storage, auth, scheduler, calendar, mail, push, tasks) are explicitly listed as core in CLAUDE.md "Building together." Widening the calendar/mail seam is a both-agree change with an ADR before implementation.
