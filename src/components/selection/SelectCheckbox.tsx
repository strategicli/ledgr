// Per-row selection checkbox for the multi-select layer (ADR-118). A small
// client island that lives at the leading edge of a list row and reads/writes
// the SelectionProvider context. Renders nothing when there's no provider, so a
// shared row component (e.g. ViewRenderer's ItemRow) can be dropped into a
// non-selectable surface (a dashboard widget) unchanged.
//
// Gated by select mode (the SelectModeToggle): off by default, this renders
// NOTHING — not an invisible box — so an idle list reserves no leading space on
// desktop and shows no clutter on touch (which has no hover to reveal on). When
// select mode is on, the box shows solid. Soft-delete + the explicit action bar
// keep an accidental tap harmless.
"use client";

import { useSelectionOptional } from "@/components/selection/SelectionProvider";

export default function SelectCheckbox({ id }: { id: string }) {
  const selection = useSelectionOptional();
  // A null child takes no flex gap, so an off row is byte-for-byte the layout it
  // had before the multi-select feature existed.
  if (!selection || !selection.selectMode) return null;

  const checked = selection.isSelected(id);

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
      className="h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-600 bg-transparent accent-[var(--accent)]"
    />
  );
}
