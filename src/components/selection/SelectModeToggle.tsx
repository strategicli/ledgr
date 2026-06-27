// The entry point to the multi-select layer (ADR-118): a small right-aligned
// "Select" control that sits just above a list and flips the SelectionProvider
// into select mode, revealing the per-row checkboxes. Off by default, so an idle
// list carries no checkbox column at all (SelectCheckbox renders nothing) —
// that reclaims the leading space on desktop and avoids always-on boxes on
// touch. Toggling back off ("Done") clears the selection.
//
// Lives inside the provider (one per selectable surface), so it shares the same
// client state as the checkboxes and the floating BulkActionBar without any
// per-page wiring. Hidden when there's nothing to select.
"use client";

import { useSelection } from "@/components/selection/SelectionProvider";

export default function SelectModeToggle() {
  const { selectMode, setSelectMode, total, count } = useSelection();
  if (total === 0) return null;

  return (
    <div className="mt-4 flex justify-end">
      <button
        type="button"
        onClick={() => setSelectMode(!selectMode)}
        aria-pressed={selectMode}
        className={`rounded px-2 py-0.5 text-sm transition-colors ${
          selectMode
            ? "bg-neutral-800 text-neutral-100"
            : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        }`}
      >
        {selectMode ? (count > 0 ? `Done · ${count}` : "Done") : "Select"}
      </button>
    </div>
  );
}
