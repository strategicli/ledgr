# Exploration: drag-and-drop interactions on the canvas and properties

**Status:** parked (Brandon, 2026-06-14). Not intent, not a decision. Several related ideas grouped here.

## Ideas

### 1. Drag a related entity onto the canvas to create an @-mention

Today, @-mentions are typed inline in the editor. If a person (or any entity) is visible in the Related panel at the bottom of the canvas, Brandon wants to **drag their name from the panel and drop it into the editor body** to insert a `[@Name](ledgr://item/<uuid>)` mention at the drop point.

The reverse is also interesting: dragging selected mention text from the canvas down to the properties area to create a formal relation edge (if one doesn't already exist).

This is a **canvas ↔ properties bridge** — a shortcut for something that already works through the keyboard.

### 2. Drag to reorder properties

The custom properties section on a canvas shows fields in the order defined in the type's property schema. Brandon wants to **drag a property row to reorder it** within the item's property display (not the type definition — just the visual order for this item, or globally for the type via the type builder).

There are two flavors:
- **Per-item property order:** store a display-order preference per item (rides `properties` jsonb, no schema change).
- **Per-type default order:** reordering in the type builder already works (slice 33 / ADR-044 built property reorder there). If that's insufficient, a drag handle on the canvas properties strip could call `PATCH /api/types/[key]` to update the schema order.

### 3. Remove a property with an X on click/tap

Today there's no way to clear a custom property value from the canvas without editing the field to empty. A small **×** that appears on hover/tap on a filled property row would clear its value (PATCH `properties.{key}` to null/undefined). This is a UX convenience, not a structural change.

### 4. Drag to rearrange canvas panels

The canvas has a fixed layout (editor + Related panel + property strip). Brandon may want to rearrange these (e.g., put related entities above the editor, or collapse certain panels). This is closer to the dashboard-widgets exploration — a configurable per-type canvas layout — and is lower priority than items 1–3 above.

## Constraints

- **Rule 5 (few dependencies).** Tiptap has a first-party `@tiptap/extension-drag-handle` for block-level drag within the editor. For cross-component drag (panel → editor), plain HTML5 `draggable` + `ondrop` is sufficient; no DnD library needed.
- **Rule 8 (fast + cheap).** A drag-to-mention should resolve the drop target synchronously from already-loaded data (the related item is already in the panel). No new fetch on drop.
- **Mobile compatibility.** HTML5 DnD doesn't work well on touch screens. Touch-based drag requires a JS polyfill (e.g., `@atlaskit/pragmatic-drag-and-drop` has touch support) or a press-and-hold gesture handler. Given the mobile-first direction, any implementation needs to work with both mouse and touch.

## Relationship to other work

- **Kanban drag-and-drop** (moving cards between board columns) is a related but separate problem — it's about the board view, not the canvas. The board uses the `ViewRenderer` component; DnD there would use the same touch-compatible approach. Noted as a missing feature in `next_steps.md`.
- **Block-level editor drag** (reordering paragraphs/blocks inside the Tiptap editor) is Tiptap's own drag-handle extension — a separable, self-contained addition to the editor slice.

## Open questions

- Does drag-to-mention feel natural, or is it a rare gesture that adds complexity for little gain? Typing `@` is already fast.
- For property reordering: per-item or per-type? Per-type (updating the type schema) is more useful but affects all items of that type.
- Should the × on a property confirm before clearing, or clear immediately (with undo as the recovery path)?
