# Exploration: a confidential / privacy tier for sensitive content

**Status:** ✅ **RESOLVED 2026-06-17 — declined for v1.0 (ADR-075).** The single-user + Clerk + owner-scoped posture is judged sufficient (Brandon's call); no `confidential` flag or field encryption in v1.0. Revisitable later or for Tyler's instance. Kept below for the record. *(Was: parked, open for Brandon + Tyler — primary open question behind any Discipleship/pastoral content.)* Core (a cross-cutting invariant that touches the MCP, export, and briefing contracts), so it lands as an ADR before it builds, and whatever is chosen applies to both instances as a shared platform capability (not a per-module hack).
**Source:** cherry-picked from Tyler's `tyler/additions-for-review` branch (`ty-additions/module-discipleship.md` "Privacy tier", `ty-additions/FOR-BRANDON-approach-diff.md`). The PRD already wrestled with this in §6.3 and deferred a field-encrypted tier.

## The need

Pastoral, discipleship, and personnel notes are the most sensitive data in the system, and both builders have the need (Brandon as Executive Pastor, Tyler for discipleship relationships). The question is what "stricter privacy" should formally mean.

## The two options

- **(a) A `confidential` flag (Tyler's lean).** Flagged items are **excluded from the MCP server, from export, and from briefings**, while staying searchable inside the authed app. Plain meaning: "Claude can't see it, nothing auto-surfaces it, it never leaves the app." Simple and cheap, and probably sufficient for a single-user app already behind Clerk plus a personal login.
- **(b) Field-level encryption at rest.** Even a database breach reveals nothing. Much heavier, and arguably overkill given the existing auth posture.

**Undecided.** Tyler's gut leans (a). This is a genuine decide-together item because the choice is a shared platform capability.

## What to decide together

- (a) vs (b), or (a) now with (b) as a later upgrade path.
- If (a): the exact exclusion surface. Confirm it covers every egress (MCP tools, OneDrive/file export, briefings/agenda pushes, share tokens, and any future integration pull) so "never leaves the app" actually holds. A single `confidential` boolean checked at each egress, owner-scoped like everything else.
- Whether "searchable inside the app" includes FTS results that might be surfaced in a future Claude-assisted in-app search (which would re-expose it to a model) and where the line sits.

## Why it is core

It changes what the MCP/API contract, export, and briefings are allowed to return, which are cross-cutting invariants in CLAUDE.md "Building together." Both-agree plus an ADR before implementation.
