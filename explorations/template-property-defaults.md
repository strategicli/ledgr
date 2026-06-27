# Exploration: templates that preset people/relations (and core fields)

**Superseded / expanded (2026-06-20, ADR-093):** the templates feature is being redesigned. Templates become real prototype items (clone-to-apply via `cloneItemSubtree`), gaining child items, dynamic variables (dates + `{{ask:…}}` prompts + computed tokens), and apply-to-existing (fill-blanks/overwrite), with a per-type default + chooser. See `next_steps.md` "Templates redesign" (slices TPL1–TPL5) + ADR-093. Option A (relation defaults) shipped (below) and folds into the prototype item's real relations. This doc is kept for the record.

**Extended again (2026-06-27, ADR-123):** option C below (presets via matchers) is now being built, but *better* — instead of a separate `matchers` table, a template carries an optional **`match_config`** (a calendar-match condition + `autoApply`), so a template both selects which events it governs AND pre-relates the people (its prototype edges) + holds recurring content. A pinned event→person match becomes exactly such a template. Paired with an always-on person suggester (attendee email + fuzzy title/details). See `next_steps.md` "Auto-match events to people via templates" (EM1–EM4) + ADR-123. This doc stays for the record.

**Status:** option A **BUILT** (2026-06-14, ADR-050); the rest still parked. What shipped: `relation_defaults` on `templates` (migration 0010) + the "Related items" picker in `TemplateBuilder` + apply-writes-edges via `relateItems`. Brandon waived Tyler's core sign-off (he's not on core yet). Still open: the broader **`relation` property kind** (option B — folds into `entity-vs-custom-type.md`) and presetting **core structured fields** (the "adjacent ask" below). Original note kept below for the record.

## What Brandon hit

> "Creating a template does not allow me to customize the properties for that item/type. If I'm making a template for a pastors meeting I should be able to list who normally comes, and a new meeting from that template should have those people already selected."

## What's actually there now (ADR-045)

The template builder **does** preset properties, but only the type's **custom** properties. `TemplateBuilder.tsx`'s `DefaultControl` iterates the type's `property_schema` and renders a default input for every kind it supports: text, url, number, date, checkbox, select, multi_select (`src/components/build/TemplateBuilder.tsx`). Applying the template seeds `items.properties` with those defaults (`createItemFromTemplate`, `src/lib/templates.ts`).

So the feature works, but the experience for a **meeting** template is "nothing to customize," because:

1. **Core types ship with no custom properties.** After the ADR-018 field-discipline pass, the system types (meeting/task/note/entity/link) carry their structured fields in code, not as `property_schema` rows. A meeting type's `property_schema` is empty, so the defaults editor renders empty. The fix for *that* is partly discoverability (add a custom property to the meeting type in Build and it appears in the template editor) and partly the gap below.

2. **The thing Brandon wants to preset — attendees/people — isn't a property at all.** Meeting attendees live in `properties.calendar.attendees` (system sync metadata, set by calendar sync; `src/lib/calendar/sync.ts`), and the people a meeting is *about* are **relation edges** in the `relations` table (item↔entity), surfaced via @-mention + the Related panel. Neither is a `property_schema` field, so neither is reachable from the property-defaults editor.

3. **There is no `relation` property kind.** It's deliberately deferred (`src/lib/types.ts`: "item-to-item links already have the @-mention + Related panel"). And templates have no `relation_defaults` — `createItemFromTemplate` only seeds `properties`, never writes edges.

So: presetting attendees/people on a template is genuinely **not supported today**, and it can't be faked with the current property kinds (select options are static strings, not entity references).

## Options if built

- **A — `relationDefaults` on templates (targeted, recommended).** Add a `relation_defaults` jsonb to the `templates` table (`[{ targetId, role? }]`); a "Related items/people" picker in `TemplateBuilder` (reuse the @-mention/relate picker that already exists); `createItemFromTemplate` writes the edges after `createItem` via the existing `addRelation` path. Keeps relations in the relations table where they belong; no new property kind; doesn't touch the core property model. Smallest blast radius for exactly Brandon's ask. The `templates` table is owner-scoped config, but the *concept* of relation-defaults brushes core, so it still wants an ADR + Tyler heads-up.
- **B — ship a `relation` property kind.** Bigger: add `relation` to `PROPERTY_KINDS`, a picker `DefaultControl`, validation, render/edit on the canvas, and resolve it against `entity-vs-custom-type.md`. This is the change CLAUDE.md names as the trigger to revisit that exploration. More power (relations become first-class typed properties) but a real core decision for both builders. Option A doesn't preclude it.
- **C — presets via matchers (no schema change).** A matcher detects the recurring meeting (attendee/series/title) and applies template + relations on calendar sync (`applyMatchersToMeeting`). Reuses existing machinery, but it's reactive (the event must arrive from the calendar first) and doesn't serve "+ New from template" the way Brandon described.

## Adjacent ask worth capturing

Templates also can't preset **core structured fields** (a task template defaulting urgency or a due-date offset, a meeting template defaulting a duration/agenda). Those aren't in `property_schema` either. If A is built, consider a small whitelist of presettable core fields per type alongside `relationDefaults`.

## Recommendation

Park; when Brandon wants it, do **A** (relationDefaults) behind an ADR with a Tyler heads-up — it's the cleanest path to the literal "attendees pre-selected" ask and stays out of the core property model. Fold **B** into the `entity-vs-custom-type.md` decision rather than deciding it here. See [[entity-vs-custom-type]], [[type-and-kind-ux]].
