# Exploration: Scripture passages as first-class entities

**Status:** parked, open for Brandon + Tyler. Core (a new entity kind + relations/search), so both-agree + ADR before it builds.
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
