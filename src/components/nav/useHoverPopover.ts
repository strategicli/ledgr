"use client";

import { useEffect, useRef, useState } from "react";

// Hover-intent + click-toggle open state for a popover-triggering button, with
// outside-click dismiss. Split out of NavShell.tsx: the nav's tools-group and
// Favorites popovers both open on hover for hover-capable pointers (a short
// close delay bridges the gap between the trigger and the detached popover, so
// dragging the pointer across to it doesn't dismiss the menu), and toggle on
// click for touch (no open-then-close flicker on a tap). `dismissSelector`
// scopes the outside-click listener (e.g. "[data-nav-tools]").
export function useHoverPopover(dismissSelector: string) {
  const [openId, setOpenId] = useState<string | null>(null);
  const hoverCapable = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hoverCapable.current = window.matchMedia?.("(hover: hover)").matches ?? false;
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const hoverOpen = (id: string) => {
    if (!hoverCapable.current) return;
    cancelClose();
    setOpenId(id);
  };

  const hoverClose = () => {
    if (!hoverCapable.current) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenId(null), 150);
  };

  // On a hover-capable pointer, click always (re)opens this id — hover is
  // already driving open state, so a click shouldn't fight it by toggling
  // closed. On touch, click toggles: open if closed, close if already open.
  const toggle = (id: string) => {
    setOpenId((o) => (hoverCapable.current ? id : o === id ? null : id));
  };

  useEffect(() => {
    if (!openId) return;
    function onClick(e: MouseEvent) {
      if (!(e.target as Element).closest?.(dismissSelector)) setOpenId(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openId, dismissSelector]);

  return { openId, setOpenId, hoverOpen, hoverClose, toggle };
}
