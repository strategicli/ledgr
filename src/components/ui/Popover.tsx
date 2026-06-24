// A small anchored popover: a trigger button that opens a floating panel with
// arbitrary editor content. Closes on outside click or Esc. Built in-house (no
// Radix/Floating-UI) to keep dependencies lean (Principle 5); it generalizes the
// open/outside-click/Esc logic that ConfirmButton pioneered, for content-bearing
// popovers (the task rail's Schedule/Due/Priority/Status rows, ADR-108).
//
// The panel renders in a portal to <body> with fixed positioning measured from
// the trigger. That's deliberate: the item modal panel is `overflow-hidden`
// around an inner scroll area, so an in-flow `absolute` popover (the tall
// Schedule editor especially) would clip against it. Fixed + portal floats above
// the modal and never clips; it flips above the trigger and caps its height when
// space below is tight, and re-measures on scroll/resize so it tracks the row.
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Coords = { left: number; top?: number; bottom?: number; maxHeight: number };

export default function Popover({
  trigger,
  triggerClassName,
  ariaLabel,
  panelClassName,
  width = 288,
  align = "right",
  children,
}: {
  // The trigger's visible content (a row face) and its button styling.
  trigger: ReactNode;
  triggerClassName?: string;
  ariaLabel: string;
  // Extra classes on the floating panel (e.g. spacing); width is a px number so
  // we can clamp it to the viewport when positioning.
  panelClassName?: string;
  width?: number;
  // Which trigger edge the panel aligns to. "right" opens leftward (the default
  // for a right-hand rail, so the panel grows into the page, not off-screen).
  align?: "left" | "right";
  // A node, or a render fn given a `close()` so an editor can dismiss on commit.
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - margin * 2);
    const left =
      align === "right"
        ? Math.max(margin, Math.min(r.right - w, vw - w - margin))
        : Math.max(margin, Math.min(r.left, vw - w - margin));
    const spaceBelow = vh - r.bottom - margin;
    const spaceAbove = r.top - margin;
    // Prefer opening downward; flip up only when below is cramped and above
    // genuinely has more room.
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      setCoords({ left, bottom: vh - r.top + margin, maxHeight: spaceAbove });
    } else {
      setCoords({ left, top: r.bottom + margin, maxHeight: spaceBelow });
    }
  }, [align, width]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Claim the Esc so the parent modal doesn't also close. The item Modal
        // skips closing when defaultPrevented is already set, but its listener
        // sits earlier on `document`, so a bubble-phase preventDefault here runs
        // too late. Listening in the CAPTURE phase runs us first — we mark the
        // Esc handled, then the modal's bubble handler sees it and stands down.
        e.preventDefault();
        setOpen(false);
      }
    };
    // Capture-phase scroll catches the modal's inner scroll container too, so the
    // panel stays glued to its row.
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              bottom: coords.bottom,
              width: Math.min(width, window.innerWidth - 16),
              maxHeight: coords.maxHeight,
            }}
            className={`z-[60] overflow-y-auto overflow-x-hidden rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-neutral-200 shadow-xl shadow-black/50 ${
              panelClassName ?? ""
            }`}
          >
            {typeof children === "function"
              ? (children as (c: () => void) => ReactNode)(close)
              : children}
          </div>,
          document.body
        )}
    </>
  );
}
