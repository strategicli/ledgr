# Integrations: Savor, Atlas, GitHub & the Provider Seams

**Status:** Draft v0.1
**Builds on:** PRD §5 (integrations), §6.1 (provider-interface discipline), open Q7 (non-Microsoft users)

This doc covers the connections that make Ledgr a *hub* rather than a standalone app, plus the seams that let those connections (and Brandon's Microsoft ones) coexist.

---

## Provider seams (the foundation for all of it)

Brandon's §6.1 already preaches provider-interface discipline — storage is behind an interface, with auth and scheduler flagged to follow for the Phase-4 local build. **This proposal extends the same discipline to calendar and email-in**, because that's the difference between Ledgr being Brandon-shaped and being genuinely generalizable.

| Concern | Brandon's adapter | Tyler's adapter |
|---|---|---|
| Sign-in | Microsoft (Entra/Graph) | Google |
| Calendar | Graph | Google Calendar |
| Email-in | Outlook folder via Graph `messages/delta` | Gmail label/query (or skip) |
| Export/backup | OneDrive | iCloud / Google Drive / R2 |
| Storage | R2 | R2 (same) |
| Scheduler | GitHub Actions → authed endpoints | same |

**This directly answers Brandon's open question 7.** Building the calendar/email seam now (rather than hard-coding Graph) is the work that lets the "generalizes to any user" claim actually hold. It lands in Tyler's instance first (he *needs* Google), which means Tyler effectively builds and proves Q7's answer.

---

## Savor → Ledgr

**The cleanest integration of the set**, because Savor isn't loose files — it's a real Postgres/Next.js/Drizzle app (Tyler's stack) with `sessions.content` as markdown and **structured passage references already broken out** (`passage_items`: `book_slug`, `chapter`, `verses`).

- **Direction:** Savor pushes on session-complete, or Ledgr pulls nightly. Either works; push-on-complete is tidier.
- **Mode:** **read-only mirror.** Savor stays the calm, no-nag writing surface (by explicit design — no notifications, no shame); Ledgr holds a linked, searchable reflection. Do *not* make Savor entries editable from inside Ledgr's busy brain.
- **Linking:** each mirrored entry links to its `passage` entity (§4 of the overview) with **zero parsing** — Savor already emits the structured passage. This is what makes "everything I've journaled on Hebrews" a real query, and the seed for future sermon series.
- **Entity type:** mirrored entries are a `savor-entry` system type (or `note` with a `source: savor` marker), read-only flag set.
- **The prayer loop:** the Discipleship module's `prayer_request` items flow *into* Savor (Savor is becoming Tyler's devotional surface, and explicitly left prayer requests as a deferred open slot). Person → prayer request (Ledgr) → surfaces in Savor devotions. Closes a loop both apps were left open for.

## Atlas → Ledgr

- **Direction:** Ledgr reads from Atlas (work tasks/projects). Read-only aggregation in v1.
- **Why read-only / why a boundary:** Atlas is **church org property** (atlas.bethanycentral.org), Ledgr is personal. Clean data-ownership boundary matters — work tasks *surface* in the one brain, but Atlas stays source of truth and other staff never touch Ledgr. Write-back (create an Atlas task from Ledgr) is a deliberate later phase, not v1.
- **Mechanism:** Atlas exposes a read API or MCP endpoint; Ledgr consumes it behind the same integration-adapter seam. (Atlas is also Tyler's stack, so this is friendly.)

## GitHub → Ledgr (Tyler-only; dev portfolio)

- **Need:** Tyler is building many apps; he wants a surface showing where each is and what's next, pulling from repo `next_steps.md` files (the very convention Ledgr itself uses).
- **Mechanism:** scan repos (webhook on push, or daily scan), read `next_steps.md`, surface project state. Optionally **generate tasks** from open next-steps and push to Ledgr/Todoist.
- **Staleness nudge (nice-to-have):** "Cuelist: no commit in 3 weeks, 4 open next-steps" — deterministic, surfaced in a briefing.
- Not Brandon's need; lives entirely in Tyler's instance.

## MCP as the integration fabric (the unifying idea)

If Ledgr aggregates Savor + Atlas *and* exposes its own MCP server, then **one Claude connector gives visibility into the whole ecosystem through a single hub** — versus three separate MCP servers queried independently. The hub approach is cleaner conversationally; it's the "ask Claude direct questions about my digital brain" goal from the very first interview. Each spoke app can still expose its own MCP for app-to-app use, but Ledgr-as-hub is the primary conversational surface.

Read/write scope for Ledgr's MCP: **read-everything + capture-write** is the safe, powerful v1 (matching Brandon's thin-server §5.5 plus a capture tool). Full CRUD through Claude is phased deliberately. Confidential-flagged items (discipleship privacy, open question) are walled off from MCP entirely.

---

## Build sequencing for integrations

These are *not* early work — modules come first. Rough order once modules exist:

1. **Provider seam for calendar/email** (needed before any Google calendar work; also closes Brandon's Q7).
2. **Savor pull** (cleanest; high personal value; feeds passage entities).
3. **Ledgr MCP hub** (pulled forward vs Brandon's Phase 3 — see discussion doc #4).
4. **Atlas read link.**
5. **GitHub scan** (Tyler-only, lowest urgency).
