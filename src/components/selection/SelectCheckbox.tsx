// Per-row selection checkbox for the multi-select layer (ADR-118). A small
// client island that lives at the leading edge of a list row and reads/writes
// the SelectionProvider context. Renders nothing when there's no provider, so a
// shared row component (e.g. ViewRenderer's ItemRow) can be dropped into a
// non-selectable surface (a dashboard widget) unchanged.
//
// Visibility follows the RowAction convention: hover-revealed on desktop while
// nothing is selected, and pinned visible once a selection is in progress (and
// always on touch, which has no hover). Soft-delete + the explicit action bar
// keep an accidental tap harmless.
"use client";

import { useSelectionOptional } from "@/components/selection/SelectionProvider";

export default function SelectCheckbox({ id }: { id: string }) {
  const selection = useSelectionOptional();
  if (!selection) return null;

  const checked = selection.isSelected(id);
  const active = selection.count > 0;

  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={checked ? "Deselect row" : "Select row"}
      // Range-select on shift-click: stop the click reaching the row link, then
      // toggle with the modifier. onChange alone loses shiftKey, so drive it
      // from onClick and keep onChange as a no-op for controlled-input warnings.
      onClick={(e) => {
        e.stopPropagation();
        selection.toggle(id, e.shiftKey);
      }}
      onChange={() => {}}
      className={`h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-600 bg-transparent accent-[var(--accent)] transition-opacity ${
        checked || active ? "opacity-100" : "opacity-0 group-hover:opacity-100 max-sm:opacity-100"
      }`}
    />
  );
}
