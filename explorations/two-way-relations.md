# Exploration: two-way relations — a derived reverse section on the target

**Status:** parked (carried forward from Brandon's 2026-06-21 call, re-verified against main 2026-06-22). Not intent, not a decision. **Small, concrete, post-1.0.** Builds directly on ADR-067 typed relations + the existing `RelatedPanel`; no schema change.

> This is the one piece of orphaned work from the dead `relations-twoway-inline-edit` branch worth carrying. The branch's *inline-editing* half is already on main as a superset (ADR-068). Its *two-way relations* half was never built and is a genuine refinement.

## The idea

A typed relation (ADR-067) is a directed edge: a `book`'s **Author** field points at a `person`. On the **book** that reads as a named "Author" section. On the **person** it should read back as a named, glyph-marked **"Books"** section, derived from the incoming edge — so a typed relation reads as two-way without the user declaring a reverse field.

## What's true on main today (verified 2026-06-22)

The reverse link is *shown* but not *named*. The data is already on screen; only the framing is missing.

- A relation field's value is edges **from** the host (`outgoingRelationsByRole`, `src/lib/relations.ts:150`), bucketed by role and rendered as the host's named field sections (`RelatedPanel.tsx` builds `fieldSections` from the host type's own `propertySchema`). The in-code comment is explicit: "Directional on purpose — the field's owner is the source — unlike the direction-blind Related panel" (`relations.ts:147-149`).
- Everything else — including every **incoming** typed edge — falls into the generic "grouped by type" backlinks list, labeled by the *related item's type*, not by any relation field. The backlinks read path is "direction-blind (a row is 'linked', not 'linked from')" (`relations.ts:203-204`; ADR-015, `decisions.md:178`).
- `PropertyDef` (`src/lib/types.ts:68-75`) declares only the **forward** side: `targetType` + `cardinality`. There is no reverse/inverse field, so the reverse section can only be **derived** — and that derivation does not exist.

Net: on the Person, the Book appears under the generic "Books" type group, carrying no relation-field label and no glyph distinguishing "this is the reverse of an Author link" from "this is just some book that happens to mention this person."

## The build (sketch — not decided)

A symmetric counterpart to `outgoingRelationsByRole`: read **incoming** typed edges, resolve each edge's `role` against the *source* type's `PropertyDef.label`, and group them into named reverse sections.

- New read: `incomingRelationsByField(ownerId, itemId)` — find edges where `target = item` whose `role` matches a relation-field key on the *source's* type; group by `{sourceType, fieldKey}`; resolve the section label (e.g. "Books — via Author", or just the source type's plural, TBD by the UX below).
- `RelatedPanel` renders these derived reverse sections (with the source type's glyph) above or alongside the generic backlinks group, and *removes* those rows from the generic group so a link isn't shown twice.
- Pure read-derivation: no new edge is written, no schema change, no reverse field stored. It's a second view over the same `relations` rows the panel already reads.

## Constraints to honor if built

- **Everything is an item / one relations table (rules 1-2):** no reverse field is stored; the reverse is derived from the existing directed edge at read time.
- **Fast + cheap (rule 8):** body-free, owner-scoped, index-backed on `relations.target_id` — the same shape as the existing both-directions query. One extra bounded read on item open, or fold into the existing related query.
- **Core, both-agree + ADR if it graduates:** it touches the relations read model + the universal `RelatedPanel`, both core. Small, but a `decisions.md` ADR + Tyler agreement before merge.

## Open questions

- **Section naming.** Label by the source type's plural ("Books"), by the forward field ("Author of"), or both ("Books · as Author")? A person who is the Author of some books and the Editor of others would want the field distinction; a single reverse group loses it.
- **Many incoming roles.** A `person` can be the target of Author, Attendee, Assignee, Owner edges from several types at once. Cap, collapse, or show all derived sections?
- **Interaction with related-items-discovery.** Discovery (`related-items-discovery.md`) surfaces *unlinked* guesses; this names *existing* edges. Keep them visually distinct (this sits with the real `Related` edges; discovery sits below).
- **Does it earn its weight before 1.0?** Almost certainly post-1.0 — the link is already visible, this is a readability upgrade.

## Relationship to other parked work

- **ADR-067 (typed relations)** — the forward half this mirrors. `outgoingRelationsByRole` is the template to invert.
- **`related-items-discovery.md`** — complementary, not overlapping: discovery guesses new links; this frames links that already exist.
- **`storage-organization.md`** — relations as the primary organizing principle (ADR-061); a two-way reading makes the graph legible from both ends.
