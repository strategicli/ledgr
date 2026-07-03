// A horizontally scrollable tab strip with edge fades (ui-refresh S6b, ADR-142).
// Fixes the mobile audit finding where a tab set (the Tasks tabs, list lenses)
// overflowed with no scroll affordance and clipped the last tab ("Plann…").
//
// It wraps the caller's own tab links as `children` (so each surface keeps its
// exact markup — sort arrows, gear, view lenses), and layers on three things a
// pure server strip can't do:
//   1. Edge-fade gradients, shown only when there's more to scroll that way.
//   2. The active tab scrolled into view on mount (mark it `data-tab-active`).
//   3. Optional swipe-between-tabs: when `navHrefs` + `activeIndex` are passed,
//      a deliberate horizontal swipe navigates to the adjacent tab. The strip
//      then uses `touch-action: pan-y` so vertical page scroll still passes
//      through and the horizontal gesture is ours (no scroll-vs-swipe fight).
//
// No dependency (Principle 5); the swipe claim mirrors SwipeRow's discipline
// (claim only on a mostly-horizontal drag past a threshold). The scroller is
// tagged `[data-scroll-x]` so a row SwipeRow above/below suppresses its own
// gesture when a touch starts inside the strip.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const CLAIM_PX = 40; // horizontal distance before a swipe changes tabs
const V_TOLERANCE = 1.5; // must be mostly horizontal: |dx| > 1.5·|dy|

export default function TabStrip({
  children,
  navHrefs,
  activeIndex,
  className,
}: {
  children: ReactNode;
  // Ordered hrefs of every tab + the active tab's index. When both are set the
  // strip is swipeable (left = next, right = previous); omit for scroll-only.
  navHrefs?: string[];
  activeIndex?: number;
  className?: string;
}) {
  const router = useRouter();
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const start = useRef<{ x: number; y: number } | null>(null);
  const claimed = useRef(false);

  const swipeable = Array.isArray(navHrefs) && typeof activeIndex === "number";

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    update();
    // Keep the active tab visible (fixes the clipped last tab on a phone).
    el.querySelector<HTMLElement>("[data-tab-active]")?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [children]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (!swipeable) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    claimed.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!swipeable || !start.current || claimed.current) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (Math.abs(dx) > CLAIM_PX && Math.abs(dx) > V_TOLERANCE * Math.abs(dy)) {
      claimed.current = true;
      const next = dx < 0 ? activeIndex! + 1 : activeIndex! - 1;
      if (next >= 0 && next < navHrefs!.length) router.push(navHrefs![next]);
    }
  };
  const onTouchEnd = () => {
    start.current = null;
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        ref={scroller}
        data-scroll-x
        className="no-scrollbar flex gap-1 overflow-x-auto"
        style={swipeable ? { touchAction: "pan-y" } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-0 to-transparent transition-opacity ${
          atStart ? "opacity-0" : "opacity-100"
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-0 to-transparent transition-opacity ${
          atEnd ? "opacity-0" : "opacity-100"
        }`}
      />
    </div>
  );
}
