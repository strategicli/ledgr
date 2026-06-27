// Keeps an anchored dropdown/popover on-screen. Dashboard popovers default to
// `right-0` (anchor the menu's right edge to the trigger — good for the top-right
// toolbar), but the same components also open from a widget gear or a container's
// add button, which can sit at the LEFT edge, where a right-anchored menu would
// extend off-screen. measure() (called from the trigger's onClick, not an effect,
// so no set-state-in-effect) picks `left-0` only when `right-0` would overflow and
// `left-0` fits — otherwise it leaves the default.
"use client";

import { useRef, useState } from "react";

export function usePopoverAlign(width: number) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [alignLeft, setAlignLeft] = useState(false);
  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const fitsRight = r.right - width >= 8; // right-anchored menu's left edge ≥ 8px
    const fitsLeft = r.left + width <= window.innerWidth - 8;
    setAlignLeft(!fitsRight && fitsLeft);
  };
  return { triggerRef, alignLeft, measure };
}
