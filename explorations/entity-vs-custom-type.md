# Exploration: entities vs. custom types — is the boundary right, or just confusing?

**Status:** ✅ **RESOLVED (2026-06-14, ADR-055 — Brandon + Tyler agreed; the 6.14 build meeting re-raised the confusion and Brandon closed it that evening).** The conclusion went the *other* way from this doc's original leaning: rather than keep `entity` as a bespoke type, we **retired the `entity` meta-type entirely**. It became a single bespoke **`person`** system type; the `kind` column was dropped (sub-classification is now a `select` property); the entity-only interactive view became universal (every item's `RelatedPanel` is now interactive); and the `entityId` filter was renamed `relatedTo`. The **`relation` property kind stayed deferred** at the time — this doc's key finding held: it was *not* required to remove `entity`. See ADR-055 for the full decision and scope. **Update (2026-06-16, ADR-064): the `relation` kind is now un-deferred** — typed relation fields (Author/Attendees boxes, any type, user-added), inline create-on-miss, and a hidden `unmarked` placeholder type for untyped-on-the-fly captures. The "revisit when the relation kind lands" note below is now live. The analysis below is kept as the record of how we got there.

---

_Original exploration (pre-decision), kept for the record:_

## The question that prompted this

Now that the Build surface (slice 33, ADR-044) lets Brandon create any type with his own properties and relate items however he wants, do we still need a dedicated **`entity`** type? Or has "make a custom type and relate to it" superseded it?

## What's genuinely shared (the source of the "do we still need it?" feeling)

A custom-type-with-relations already covers the *data* half of what entities do:
- Relating any item to any other — the `relations` table has **no type restriction**; any item can link to any item.
- Backlinks (`RelatedPanel` works for any item), properties/custom fields, full-text search, parent/child hierarchy, soft-delete + revisions, OneDrive export.

So the instinct isn't wrong: the **relational/tagging substrate is now generic.** That's what makes entity feel possibly redundant.

## What only `entity` does today (hard-wired to `type = 'entity'`)

These are bespoke affordances custom types deliberately don't get (Principle 6, "bespoke-first, one catch-all"). Roughly ten special-cased sites:
- **Entity pages** — `/entities`, "all related items grouped by type / kind" (the Notion tag-as-dashboard view).
- **Embedded query view on the canvas** — the interactive, check-off-able related-items panel (`MarkdownCanvas`, `item.type === "entity"`). The real 1:1-prep surface.
- **Meeting prep + matchers** — `getMeetingEntities` filters `e.type = 'entity'`; calendar attendees match to *person entities*. The whole meeting/calendar machinery is built on entities.
- **Relate-at-capture** — the quick-capture "Relate to…" picker searches only `type=entity`.
- **`kind`** — a real, indexed column (person/org/project/topic/campus; ADR-003) with its own picker in capture + the field strip. No other type has it.

Removing entity would be a rewrite of meeting prep, matchers, and capture, with **no generic replacement** for entity pages or embedded views. So practically, entity stays.

## The reframe: maybe it's the *implementation* that's confusing, not the concept

Two things make the boundary feel murkier than it is:

1. **Entity is doing two jobs at once.** It's (a) the *unified tagging/relational index* (PRD §3.2 — the thing everything links to) **and** (b) the *bespoke "people/orgs/projects" type the meeting integrations need*. Those are conceptually separable. The first job is now also served by generic custom types, which is the overlap Brandon is sensing.
2. **The privileged affordances are entity-gated, not capability-gated.** Entity pages and embedded views key off `type === 'entity'` rather than off a *capability* a type could declare (e.g. "this type is an anchor / tag-like / has a relation property"). That's why it reads as "entity is special-cased" rather than "entity opts into a general capability."

## The fork that would actually resolve it (gated, not now)

The clean long-term answer hinges on the **`relation` property kind**, currently deferred (`src/lib/types.ts:21`). If a custom type could declare a relation property, then:
- The "related items grouped by type" page and the embedded query view could become a **general capability any type opts into**, not an entity-only hardcode.
- `entity` would shrink to its honest core: *the type that ships with calendar/meeting matchers and the `kind` vocabulary* — a bespoke type like any other, not a privileged universal.

That's the bespoke-first model working as intended (system types ship bespoke behavior; custom types inherit generic behavior from property kinds). It's an argument for **keeping entity** while **generalizing the affordances** later.

## Recommendation / posture

- **Keep entity as-is for now.** It's load-bearing and there's no generic substitute for its integrations yet.
- **Confirm the mental model out loud** (Brandon + Tyler): "entity = the bespoke anchor type wired into meetings/matchers + the unified tag vocabulary; custom-types-with-relations = the generic catch-all tier." If we agree that's the model, the confusion is resolved without a code change.
- **Revisit when the `relation` property kind lands.** At that point decide whether to generalize entity pages + embedded views to any opted-in type, leaving entity as purely the matcher-wired type. Until then, nothing to build.

## Constraints to honor if anything is ever built here

- Everything stays an item (rule 2); entity is a `types` row, never a parallel table.
- Deterministic: whatever marks a type "anchor-like" is a flag/capability/property kind, not a model call.
- Core change: the type/canvas model and the relation substrate are on the **core list** (CLAUDE.md "Building together") — both-agree + an ADR before any of this merges.
