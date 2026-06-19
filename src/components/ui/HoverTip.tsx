// HoverTip: the house explanatory tooltip (CLAUDE.md standard) as one reusable
// piece, so the pattern stops being copy-pasted per use. Pure CSS — reveals on
// hover AND on keyboard focus (group-focus-within), no JS, so it works in server
// components. Wrap a short text trigger; it gets the dotted-underline "hover me"
// affordance and a role="tooltip" panel. Pin the panel to an edge with `align`
// so it doesn't overflow near a column/screen edge.
//
// Best for explanatory TEXT labels (a control's meaning, a column header). For
// icon-only buttons the native title attribute is left in place — wrapping a
// button in a focusable trigger would nest focus targets, and the icons carry
// their own affordances.
import type { ReactNode } from "react";

export default function HoverTip({
  children,
  tip,
  align = "right",
  className = "",
}: {
  children: ReactNode;
  tip: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const pos =
    align === "left"
      ? "left-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "right-0";
  return (
    <span
      className={`group relative inline-flex cursor-help items-center ${className}`}
    >
      <span
        tabIndex={0}
        className="underline decoration-dotted decoration-neutral-600 underline-offset-2 outline-none focus-visible:decoration-neutral-300"
      >
        {children}
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-20 mt-1 w-60 ${pos} rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-neutral-300 opacity-0 shadow-xl shadow-black/50 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100`}
      >
        {tip}
      </span>
    </span>
  );
}
