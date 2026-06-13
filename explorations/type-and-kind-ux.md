# Exploration: type & kind creation/reuse UX (parked, Phase 3)

**Status:** parked notes from Brandon's 2026-06-13 click-through of the live app. Not intent, not a decision — UX directions to resolve when the **Build surface / custom type & property builder** lands (roadmap Phase 3). Recorded so they aren't lost; nothing built yet.

These are two faces of the same gap: today a "kind"/type is either free text or a fixed list, with no managed registry the UI can read.

## 1. Entity "Kind" is a free-text box (hard to reuse existing kinds)

When adding an entity, **Kind** is a text input (see `FieldStrip` `kind` case + the capture modal). So adding an entity to a kind that already exists (e.g. `person`, `org`, `project`, `topic`, `campus`, or a future `passage`) means retyping it exactly, with nothing stopping `Person` vs `person` vs `people` from fragmenting the set.

Directions to weigh (pick during the Build-surface work):
- **Dropdown of existing kinds + a "new…" option** — lowest-friction fix; the field reads the distinct kinds already in use (or a managed list) and lets you add one inline. Keeps the current one-screen flow.
- **Separate kinds-management, WordPress tags/categories style** — define/manage kinds on one screen, then add items to a kind on another. A bigger rethink of how types/kinds are created and interacted with; more structure, more screens. Brandon floated this as the larger option.
- Open question this reopens: **PRD Q6 (custom-type identity)** — are entity *kinds* just a property vocabulary, or do some graduate into their own *types*? The kind registry and the type registry may want to be the same mechanism.

## 2. Quick-capture type dropdown should include custom kinds/types (opt-in)

The quick-capture modal's type `<select>` currently lists only the core item types (task, note, meeting, link, entity — passed in as `typeOptions`). When custom types/entity-kinds exist (Phase 3), Brandon wants to be able to capture directly into them, not just the core five.

Direction to weigh:
- Make `typeOptions` **data-driven from the type/kind registry**, with an **opt-in flag per type/kind** ("show in quick capture" — e.g. a checkbox on the type's / entity-kind's settings) so the dropdown stays short and curated rather than listing everything. This pairs naturally with whatever registry #1 produces.

## 3. "Entity" means two different things in quick capture (and captures a kind-less entity)

From Brandon's 2026-06-13 use of quick capture. Two problems, both flavors of the type/kind gap above:

- **The word "Entity" appears twice, side by side, meaning two different things.** The type `<select>` offers **Entity** as a value ("make this captured thing an entity item"), and right next to it the relate-to picker reads **`@ entity`** (placeholder) / `aria-label="Entity"` — but that box means "relate this item to an *existing* entity" (person/org/topic/…), a completely different action. Having both say "entity" at the same altitude is the confusing part. Likely fix: rename the relate picker to something action-shaped and unambiguous — **"Relate to…"**, **"Link to…"**, or **"Tag…"** (the picker is `CaptureModal.tsx`'s entity typeahead; this is plain UI copy, changeable independent of the registry work).
- **Selecting type = Entity captures a kind-less entity.** The capture modal collects only type + title (+ due/urgency for tasks); it never asks for a **kind**, so capturing an "Entity" creates a bare entity with no `person`/`org`/`topic`/… — a half-formed object that then needs fixing on the canvas. Options (tie into §1/§2): when type = Entity is chosen, reveal an inline **kind** picker (reusing §1's kind registry); **or** drop Entity from the quick-capture dropdown entirely via the §2 per-type "show in quick capture" opt-in (entities get created in their own flow, not quick-captured kind-less). Brandon flagged this as a later UX-workflow call, noted here so it isn't lost.

## Why parked

Both depend on machinery that doesn't exist yet: a managed **type/kind registry** and the **Build surface** to edit it (roadmap Phase 3: "Custom type & property builder UI", "resolves custom-type identity, open Q6"). The per-type *canvas* seam (M5/ADR-041) and the module-registration boundary (M6) are the platform hooks; this is the *authoring/selection UX* layered on top. Resolve when building that surface. Related: [[project-items]] (another "what is a type" question).
