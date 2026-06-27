// Static class maps for per-widget appearance (DC1) and the swatch pickers.
// Kept as literal strings in one scanned file so Tailwind's JIT emits them (a
// computed `bg-${x}` would be purged). Imported by WidgetFrame + the gear popover.
import type { WidgetAccent, WidgetBackground } from "@/lib/dashboard-widgets";

// Tile background (the card fill). "transparent" = content floats on the stage.
export const BG_CLASS: Record<WidgetBackground, string> = {
  panel: "bg-neutral-900/40",
  transparent: "",
  amber: "bg-amber-950/50",
  blue: "bg-blue-950/50",
  green: "bg-emerald-950/50",
  rose: "bg-rose-950/50",
  violet: "bg-violet-950/50",
  slate: "bg-slate-800/50",
};

// Accent edge (a tinted left bar).
export const ACCENT_CLASS: Record<WidgetAccent, string> = {
  none: "",
  amber: "border-l-2 border-l-amber-500",
  blue: "border-l-2 border-l-blue-500",
  green: "border-l-2 border-l-emerald-500",
  rose: "border-l-2 border-l-rose-500",
  violet: "border-l-2 border-l-violet-500",
  slate: "border-l-2 border-l-slate-400",
};

// Solid swatch dots for the gear popover pickers (the visible color the option
// maps to). "panel"/"transparent"/"none" get a neutral/checkered marker.
export const SWATCH_DOT: Record<string, string> = {
  panel: "bg-neutral-700",
  transparent: "bg-transparent border border-dashed border-neutral-600",
  none: "bg-transparent border border-dashed border-neutral-600",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-400",
};
