// Touch long-press drag for the Planner month grid. The desktop mouse path
// stays native HTML5 drag (in PlannerMonth); this is the isolated TOUCH path,
// because HTML5 drag events never fire from touch. It mirrors the board's
// useBoardTouchDrag (same long-press → ghost → drop shape, same non-passive
// listener discipline so the armed move can preventDefault the page scroll) but
// hit-tests a 2D grid of `[data-day]` cells via cellAtPoint instead of x-only
// columns, and auto-scrolls the page vertically (the month doesn't scroll
// horizontally). A day cell carries data-day="YYYY-MM-DD"; the Unscheduled rail
// carries data-day="__none__" so dropping there unschedules.
"use client";

import { useEffect, useRef } from "react";
import {
  cellAtPoint,
  edgeAutoScrollVelocity,
  exceedsMoveThreshold,
  LONG_PRESS_MS,
  type CellRect,
} from "@/lib/board-touch-drag";

export type PlannerTouchDragCallbacks = {
  onArm: (cardId: string) => void;
  onOver: (day: string | null) => void;
  onDrop: (day: string | null) => void;
  onCancel: () => void;
};

export function usePlannerTouchDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  callbacks: PlannerTouchDragCallbacks,
) {
  const cb = useRef(callbacks);
  useEffect(() => {
    cb.current = callbacks;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let touchId: number | null = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let armed = false;
    let cardId: string | null = null;
    let cardEl: HTMLElement | null = null;
    let overDay: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let raf: number | null = null;
    let ghost: HTMLElement | null = null;
    let ghostOffX = 0;
    let ghostOffY = 0;

    function reset() {
      if (timer) clearTimeout(timer);
      if (raf != null) cancelAnimationFrame(raf);
      if (ghost) ghost.remove();
      timer = null;
      raf = null;
      ghost = null;
      touchId = null;
      armed = false;
      cardId = null;
      cardEl = null;
      overDay = null;
    }

    function cellRects(): CellRect[] {
      const rects: CellRect[] = [];
      el!.querySelectorAll<HTMLElement>("[data-day]").forEach((c) => {
        const day = c.dataset.day;
        if (day == null) return;
        const r = c.getBoundingClientRect();
        rects.push({ day, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      });
      return rects;
    }

    function hitTest() {
      const day = cellAtPoint(cellRects(), lastX, lastY);
      if (day !== overDay) {
        overDay = day;
        cb.current.onOver(day);
      }
    }

    function spawnGhost() {
      if (!cardEl) return;
      const r = cardEl.getBoundingClientRect();
      ghostOffX = startX - r.left;
      ghostOffY = startY - r.top;
      const g = cardEl.cloneNode(true) as HTMLElement;
      g.removeAttribute("data-card-id");
      Object.assign(g.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: `${r.width}px`,
        margin: "0",
        pointerEvents: "none",
        zIndex: "9999",
        opacity: "0.95",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        transition: "none",
        willChange: "transform",
      });
      ghost = g;
      document.body.appendChild(g);
      positionGhost();
    }

    function positionGhost() {
      if (!ghost) return;
      ghost.style.transform = `translate(${lastX - ghostOffX}px, ${lastY - ghostOffY}px) scale(1.03) rotate(1.5deg)`;
    }

    function autoScrollTick() {
      if (!armed) {
        raf = null;
        return;
      }
      const up = edgeAutoScrollVelocity(lastY);
      const down = edgeAutoScrollVelocity(window.innerHeight - lastY);
      if (up > 0) {
        window.scrollBy(0, -up);
        hitTest();
      } else if (down > 0) {
        window.scrollBy(0, down);
        hitTest();
      }
      raf = requestAnimationFrame(autoScrollTick);
    }

    function trackedTouch(e: TouchEvent): Touch | null {
      if (touchId == null) return null;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === touchId) return t;
      }
      return null;
    }

    function onTouchStart(e: TouchEvent) {
      if (touchId != null) return;
      const li = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-card-id]");
      const id = li?.dataset.cardId;
      if (!li || !id) return;
      const t = e.changedTouches[0];
      touchId = t.identifier;
      startX = lastX = t.clientX;
      startY = lastY = t.clientY;
      cardId = id;
      cardEl = li;
      armed = false;
      timer = setTimeout(() => {
        if (cardId == null) return;
        armed = true;
        spawnGhost();
        raf = requestAnimationFrame(autoScrollTick);
        navigator.vibrate?.(10);
        cb.current.onArm(cardId);
      }, LONG_PRESS_MS);
    }

    function onTouchMove(e: TouchEvent) {
      const t = trackedTouch(e);
      if (!t) return;
      if (!armed) {
        if (exceedsMoveThreshold({ x: startX, y: startY }, { x: t.clientX, y: t.clientY })) {
          reset();
        }
        return;
      }
      e.preventDefault();
      lastX = t.clientX;
      lastY = t.clientY;
      positionGhost();
      hitTest();
    }

    function onTouchEnd(e: TouchEvent) {
      if (!trackedTouch(e)) return;
      if (armed) {
        e.preventDefault();
        cb.current.onDrop(overDay);
      }
      reset();
    }

    function onTouchCancel(e: TouchEvent) {
      if (!trackedTouch(e)) return;
      const wasArmed = armed;
      reset();
      if (wasArmed) cb.current.onCancel();
    }

    function onContextMenu(e: Event) {
      if (touchId != null) e.preventDefault();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("contextmenu", onContextMenu);
      reset();
    };
  }, [containerRef]);
}
