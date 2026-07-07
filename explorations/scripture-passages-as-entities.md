# Exploration: Scripture passages as first-class entities

> **Model amended — ADR-149 (2026-07-06, accepted; Brandon + Tyler agreed; proposed as ADR-134, renumbered — 134 is the cross-device edit guard on main).** The verse-atomic *entity/item* framing throughout this doc (and ADR-060 pts 1 & 3) is dropped. A passage is now a **reference dimension, not an item**: a tiny static canon + a deterministic ref→integer resolver + a `passage_refs` interval edge table, surfaced (minimal-first) so `@/ref` behaves like a type. No 31K verse rows. Ranges are `[start,end]` intervals. ADR-060's *intent* (Bible as the relational hub; references auto-wire deterministically) is kept. Read the model below as historical; the live design is ADR-149.

**Status:** ✅ **DECIDED — ADR-060 (2026-06-14, Brandon + Tyler accepted); model amended by ADR-149 (2026-07-06, accepted, see banner above).** Ship the Bible as a pre-built relational structure (book → chapter → verse, **verse atomic**); a passage range links each verse in the range; sub-verse (11:35a/b) rejected. A deterministic RefTagger-style auto-tagger (cron, no AI) wires references in many surface forms ("Luke 11:35", "LK 11.35", "Luke 1135"). The 6.14 debate landed on **pre-built over tag-on-demand**: a free-typed tag doesn't guarantee correct shape and only tags one side of the relation. This doc is kept for the fuller framing; the build (table seed + auto-tagger) is non-core module work in the build queue. The granularity fork below is resolved (verse-atomic).

> **⚠️ Framing superseded by ADR-055 (entity → person).** This doc was written around a new `entity.kind = passage`. That model no longer exists: ADR-055 retired the `entity` meta-type and dropped the `kind` column. A passage is now a **bespoke `passage` type** (a verse is an item of that type), and other items relate to it through the type-agnostic `relations` table — exactly the "no new edge mechanism" the doc already assumed. Read "`entity.kind = passage`" below as "a `passage` type." The `relation` *property* kind referenced in the open questions stays deferred (ADR-055/056 — item-to-item relations already suffice).
**Source:** cherry-picked from Tyler's `tyler/additions-for-review` branch (`ty-additions/tyler-additions-overview.md` §4, `ty-additions/integrations-savor-atlas.md`). The fuller framing lives there.
**Related:** the `next_steps.md` "Bespoke module backlog" item "Bible books / chapters / verses, the relational hub" (this is the entity-shaped cut of that keystone), and [[entity-vs-custom-type]] (passages are a strong case for keeping a real entity model).

## The idea

Add a new `entity.kind = passage` alongside the existing `person | org | project | topic | campus`. A passage entity carries `book_slug`, `chapter`, `verses`. Any item (a sermon, a Bible lesson, a song, a seminary paper, a quote, a devotional) can then relate to a passage, and one query surfaces everything that touches a given text: "show me everything I've created or saved on Hebrews 4."

## Why it earns consideration

- It is the relational hub the other bespoke modules tie into. Sermons/Lessons, Songs, Quiet-time journals, and Papers all want to point at a passage, so the passage model is the keystone that lets the rest wire together as they land.
- It is the seed for assembling a sermon series out of years of accumulated work (every note, song, and journal entry on a book or chapter, in one place).
- It is cheap relative to the payoff: it reuses the existing entity + relations + FTS machinery rather than inventing a new subsystem.
- Savor already emits the exact shape (its `passage_items`: `book_slug`, `chapter`, `verses`), so ingestion from Savor needs zero parsing.

## Open questions / what to decide together

- **Granularity of the passage model:** one entity per book? per chapter? a parsed `Book c:v-v` reference value on the entity? This is the main modeling fork.
- **Relation to the `relation` property kind.** The backlog flags Bible passages as the first real use of a `relation` property kind (currently deferred, see [[entity-vs-custom-type]]). Decide whether the `relation` kind lands first, then the passage model on top of it, in a short ADR.
- **Canonicalization of references** (e.g. "Heb 4", "Hebrews 4:1-13", ranges crossing chapters) so two items pointing at the same text actually resolve to the same entity.

## Why it is core

A new entity kind touches the data model, the relations table, and FTS/search (all cross-cutting invariants). Per CLAUDE.md "Building together," that means both Brandon and Tyler agree and it lands as an ADR before implementation.
