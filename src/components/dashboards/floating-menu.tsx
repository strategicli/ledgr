// Portal-rendered anchored popovers for the dashboard. The widget card is
// `overflow-hidden` and lives in a react-grid-layout cell, so an `absolute`
// popover inside it gets clipped by a short widget and by neighbors. FloatingMenu
// renders into document.body with `position: fixed`, so it floats above the whole
// canvas. usePopoverPosition measures the trigger ON OPEN (in the click handler,
// not an effect → no set-state-in-effect): it right-aligns to the trigger and
// flips to left-align if that would overflow, opens downward and flips upward
// (anchored by `bottom`) when there's more room above, and caps maxHeight so a
// tall menu scrolls internally instead of running off the viewport.
"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export type PopoverPos = { left: number; top?: number; bottom?: number; maxHeight: number };

export function usePopoverPosition(width: number) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.right - width; // right-align to the trigger
    if (left < gap) left = r.left; // …flip to left-align if it would overflow left
    left = Math.max(gap, Math.min(left, vw - width - gap));
    const spaceBelow = vh - r.bottom - gap;
    const spaceAbove = r.top - gap;
    setPos(
      spaceBelow >= 220 || spaceBelow >= spaceAbove
        ? { left, top: r.bottom + gap, maxHeight: Math.max(140, spaceBelow) }
        : { left, bottom: vh - r.top + gap, maxHeight: Math.max(140, spaceAbove) }
    );
  };
  return { triggerRef, pos, measure };
}

export function FloatingMenu({
  pos,
  width,
  anchorRef,
  onClose,
  className,
  children,
}: {
  pos: PopoverPos | null;
  width: number;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  if (!pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
        zIndex: 60,
      }}
      className={className}
    >
      {children}
    </div>,
    document.body
  );
}
