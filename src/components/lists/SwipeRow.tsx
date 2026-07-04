// Swipe actions for a task-like list row (ui-refresh S5, ADR-142). A horizontal
// drag past a threshold fires a NON-destructive action: right = Complete, left =
// Schedule (opens the row menu's date picker). Both go through the shared
// useRowMenu, so swipe, long-press, and right-click all drive one set of actions
// and one undo toast. Trash is deliberately NOT a swipe — it stays in the menu
// (long-press / right-click), so a stray swipe can never delete.
//
// Gesture discipline (the mobile-swipe-navigation.md rule): the swipe is claimed
// only once |dx| > 24px AND |dx| > 2·|dy| (so vertical scrolling always wins),
// and is suppressed entirely when the touch starts inside a horizontally
// scrollable region ([data-scroll-x]). No dependency — the same touchstart/move/
// end pattern as the shipped kanban drag.
"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRowMenu, type RowMenuOptions } from "@/components/lists/RowMenu";

const CLAIM_PX = 24; // horizontal distance before the swipe is claimed
const MAX_REVEAL = 110; // how far the row can slide
const ACTION_PX = 70; // release past this fires the action

export default function SwipeRow({
  className,
  children,
  ...opts
}: RowMenuOptions & { className?: string; children: ReactNode }) {
  const { menu, open, complete, handlers } = useRowMenu(opts);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const mode = useRef<"idle" | "swiping" | "scrolling" | "suppressed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a swipe or long-press consumed the gesture, so the click it would
  // otherwise fire on the row's title link is swallowed once.
  const consumed = useRef(false);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    // Let a horizontally scrollable child (a tab strip, a chip row) own the drag.
    if ((e.target as Element).closest?.("[data-scroll-x]")) {
      mode.current = "suppressed";
      return;
    }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    mode.current = "idle";
    consumed.current = false;
    clearTimer();
    timer.current = setTimeout(() => {
      // A stationary press opens the menu (long-press), same as RowMenu.
      if (mode.current === "idle") {
        consumed.current = true;
        navigator.vibrate?.(10);
        open(start.current!.x, start.current!.y);
      }
    }, 450);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current || mode.current === "suppressed") return;
    const t = e.touches[0];
    const ddx = t.clientX - start.current.x;
    const ddy = t.clientY - start.current.y;
    if (mode.current === "idle") {
      if (Math.abs(ddx) > CLAIM_PX && Math.abs(ddx) > 2 * Math.abs(ddy)) {
        mode.current = "swiping";
        consumed.current = true;
        clearTimer();
      } else if (Math.abs(ddy) > 10) {
        mode.current = "scrolling"; // vertical scroll wins; never claim
        clearTimer();
      }
    }
    if (mode.current === "swiping") {
      e.preventDefault(); // stop the page scrolling while we slide the row
      setDx(Math.max(-MAX_REVEAL, Math.min(MAX_REVEAL, ddx)));
    }
  };

  const onTouchEnd = () => {
    clearTimer();
    if (mode.current === "swiping") {
      if (dx >= ACTION_PX && opts.canComplete) {
        void complete();
      } else if (dx <= -ACTION_PX) {
        // Schedule: open the menu with the date picker expanded (snooze/pick).
        const x = Math.min(window.innerWidth - 200, Math.max(8, window.innerWidth / 2));
        open(x, 120, { schedule: true });
      }
    }
    setDx(0);
    mode.current = "idle";
    start.current = null;
  };

  const revealing = dx !== 0;
  const right = dx > 0; // right-swipe reveals Complete on the left edge

  return (
    <li
      // touch-action: pan-y lets the browser keep vertical scrolling but hands
      // horizontal gestures to us — without it, React's passive touchmove means
      // our preventDefault is ignored and the browser scroll-fights the swipe,
      // so the row never slides (the "no feedback / not smooth" report).
      className="relative touch-pan-y overflow-hidden"
      onContextMenu={handlers.onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onClickCapture={(e) => {
        if (consumed.current) {
          e.preventDefault();
          e.stopPropagation();
          consumed.current = false;
        }
      }}
    >
      {/* The action revealed behind the sliding row. */}
      {revealing && (
        <div
          className={`pointer-events-none absolute inset-0 flex items-center px-4 text-xs font-medium ${
            right
              ? "justify-start bg-emerald-900/40 text-emerald-300"
              : "justify-end bg-sky-900/40 text-sky-300"
          }`}
        >
          {right ? (opts.done ? "↩ Not done" : "✓ Complete") : "◷ Schedule"}
        </div>
      )}
      <div
        className={`${className ?? ""} bg-surface-0`}
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 0.18s ease" : "none" }}
      >
        {children}
      </div>
      {menu}
    </li>
  );
}
