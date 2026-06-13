# Exploration: local-first split (MD files local, light cloud app)

**Status:** parked, not a current direction (2026-06-11)
**What this doc is:** a captured fork-in-the-road idea. Not PRD intent, not a decision. If a direction here is ever chosen, it graduates to an ADR in `decisions.md` and a PRD amendment.

> **⚠️ Re-weighted by ADR-037 (Markdown epoch).** This doc's option C ("true local-first: MD files canonical on disk") was rejected partly because it "fights BlockNote-JSON-canonical (markdown can't natively hold sermon colors/highlights)." That specific objection is **gone**: markdown is now the canonical body (extended dialect, colors as inline HTML), and the round-trip prototype this doc calls for is essentially the foundation rework itself. Local-first is still *not* a current direction (it still reverses rule #1 DB-canonical and fights everything-is-an-item + boring-stack), but the format barrier no longer applies — so if it's ever revisited, the gap is smaller than this doc estimated. Re-read options B and C with that in mind.

## The idea as raised

Split Ledgr into two chunks. A local chunk lives on Brandon's computer as markdown files that Claude Code can read, edit, and create directly with no MCP in the loop ("take the fetters off Claude"). A lighter cloud chunk serves fast, snappy access to basic info from the phone or another computer, backed by the database. Open challenge as raised: sync, both computer-to-computer and local-to-server, possibly P2P.

## What's already true in the current design

Most of this idea's value is already specced:

- **Claude reads everything locally.** The one-way OneDrive export (PRD §5.4) puts the whole corpus on disk as markdown with YAML frontmatter. Once Phase 1 ships, local Claude Code has full read access to Ledgr with no MCP.
- **Offline / local resilience.** Sunday-proof is a design principle: OneDrive export plus Pulpit Ready PDF cover the preach-without-cloud case, and the PWA covers cached mobile access.
- **Fast, light mobile access.** That's the PWA itself (Today view, quick capture, stale-while-revalidate).
- **Device-to-device sync.** OneDrive already does this. P2P sync solves a problem we don't have; the only hard problem is merging file edits with DB state, and that exists regardless of transport.

When this was talked through (2026-06-11), the core wins wanted were exactly the two above: Claude reads everything, and offline resilience. Neither requires changing the architecture. That's why this is parked.

## The three versions, if it reopens

**A. Read locally, write through the API (small).** DB stays canonical. Claude Code reads the export freely; writes go through the same authenticated endpoints the MCP uses, optionally wrapped in a thin CLI so it feels native. No second source of truth, so no sync problem. Cheapest possible version of "unfettered Claude."

**B. Inbox pattern (medium).** A watched `/Inbox` folder (or a frontmatter flag). Claude Code edits or creates MD files there; a deterministic importer ingests them to the DB, snapshots a revision, and the next export writes the canonical version back out. Mirrors the email-in channel (§5.3): one-way in, one-way out, never a merge. Conflict rule: DB wins, the file edit lands as a revision. Limits: round-trip latency, and BlockNote JSON ↔ markdown is lossy beyond prose, so this suits notes and tasks, not color-heavy sermons.

**C. True local-first (large, the real fork).** MD files canonical on disk, cloud demoted to a cache. Reverses rule #1 (DB canonical) and fights three more principles: BlockNote-JSON-canonical (markdown can't natively hold sermon colors/highlights), everything-is-an-item (relations, backlinks, query views don't live well in flat files), and boring-stack (a real sync engine is the heaviest dependency we could add). This is closer to a different product than a Ledgr feature.

## What would reopen this

- The "core win" shifts from *reading* to *editing*: Claude Code editing files directly becomes a felt daily need the API path can't satisfy. Reopen at option A, then B.
- Markdown-canonical becomes a terminal value (data longevity, portability as an end in itself), not just a means to Claude access. Only then is C on the table.
- A round-trip prototype is the cheap test before any of it: export an item, edit the MD, re-import, diff the BlockNote JSON. If prose-safe round-tripping proves clean, B gets much more attractive.

## Open question carried forward

How much formatting must survive file editing? "Prose-safe is fine" keeps B viable (sermons stay app-edited). "Everything, sermons too" forces inline-HTML-in-MD as a hand-editing format, which is fragile and ugly. Currently undecided; answer via the round-trip prototype above.
