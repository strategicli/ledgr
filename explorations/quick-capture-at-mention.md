# Exploration: @mention association in quick capture

**Status:** parked (Brandon, 2026-06-13). Explicitly post-v1.0. Not intent, not a decision.

## The idea

The quick capture modal (keyboard shortcut `q` on desktop) currently has a separate input box for associating the new item with entities. Two enhancements to consider together:

1. **@mention syntax in the title/description field.** Typing `@roger` while composing the item should resolve to Roger and attach the relation — same as `@`-mention already planned for the body editor (PRD §4.1). The dedicated entity-picker field could shrink to a fallback or disappear entirely, since typing `@name` inline is faster and matches how body-editor linking already works.

2. **Any item type, not just entities.** The current design associates quick-capture items with entities only. @mention in quick capture should target any item — a meeting, a note, a task — the same resolution logic the body editor uses. "Associate this new task with the hiring committee meeting" should be as easy as `@hiring`.

## Why together

Both changes converge on the same implementation: a unified `@`-mention resolver that does a fuzzy-search across all items (not just entities) and returns a relation. Building it once for the body editor (Phase 1/2) means quick capture can reuse it rather than maintain a parallel entity-only lookup.

## Relationship to existing design

- PRD §4.1 already specifies `@`-mention in the body editor creates a relation row automatically. This extends that same affordance to the quick capture surface.
- The current entity-picker in quick capture is a separate explicit field. Post-v1, it could be replaced by inline @mention, or kept as a fallback for users who prefer explicit selection.

## Open questions

- Does the existing entity-picker box stay as a fallback, or does @mention fully replace it?
- Should unresolved @mentions (no match) open a disambiguation panel, or land as a pending relation to resolve later?
- Mobile quick capture (share sheet, home screen shortcut) — does @mention syntax make sense there, or does the explicit picker stay on mobile?
