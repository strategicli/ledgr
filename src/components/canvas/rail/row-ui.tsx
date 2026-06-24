// Presentational pieces shared by the rail's popover rows (ADR-108): the row
// "face" (label · value · chevron) used as a Popover trigger, the disclosure
// chevron, and a menu item for the small option menus (Priority, Status). Pure
// components (no hooks) — they render client when used inside the client rows.

import type { ReactNode } from "react";

// The disclosure chevron on a tappable row; brightens on row hover.
export function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5 shrink-0 text-neutral-600 transition-colors group-hover:text-neutral-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M7 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Label on the left, value (or muted placeholder) + chevron on the right.
export function RowFace({
  label,
  empty = false,
  children,
}: {
  label: string;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <span className="shrink-0 text-neutral-400">{label}</span>
      <span
        className={`flex min-w-0 items-center justify-end gap-1.5 ${
          empty ? "text-neutral-600" : "text-neutral-200"
        }`}
      >
        <span className="min-w-0 truncate">{children}</span>
        <Chevron />
      </span>
    </>
  );
}

// One choice in a Priority/Status menu, with a leading swatch and a check on the
// active option.
export function MenuItem({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
        active ? "text-neutral-100" : "text-neutral-300"
      }`}
    >
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {active && <span className="text-neutral-400">✓</span>}
    </button>
  );
}
