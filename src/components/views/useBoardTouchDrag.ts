// Touch long-press drag for board (kanban) views. The desktop mouse path stays
// native HTML5 drag (untouched, in BoardDnd); this adds an isolated TOUCH path
// because HTML5 drag events never fire from touch. Hold a card ~LONG_PRESS_MS
// without moving to lift it, then drag onto a column and release. Moving before
// it arms is read as a scroll and left to the browser.
//
// Listeners are attached imperatively to the board container so touchmove can
// be NON-PASSIVE: React's onTouchMove is passive and can't preventDefault, and
// preventDefault on the armed move is the only reliable way to stop the page /
// board from scrolling under the drag. Touch events fire on the touchstart
// target for the life of the gesture, so a single delegated set on the
// container catches every move even when the finger leaves a card.
//
// While armed it also (a) floats a clone of the card under the finger — the
// real card sits under your thumb, so the clone is the only feedback you can
// see — and (b) auto-scrolls the board/page when the finger nears an edge, so
// off-screen columns are reachable on a narrow phone. Both are driven
// imperatively (no React state, no per-move re-render); the only state the
// component sees is onArm/onOver, same as the mouse path.
"use client";

import { useEffect, useRef } from "react";
import {
  columnAtPoint,
  edgeAutoScrollVelocity,
  exceedsMoveThreshold,
  LONG_PRESS_MS,
  type ColumnRect,
} from "@/lib/board-touch-drag";

export type BoardTouchDragCallbacks = {
  // The long-press fired: this card is now lifted and tracking the finger.
  onArm: (cardId: string) => void;
  // The column under the finger changed (null = over no column).
  onOver: (col: string | null) => void;
  // Finger lifted while armed: drop onto col (null = nowhere; caller resets).
  onDrop: (col: string | null) => void;
  // The drag was abandoned (touchcancel); caller resets its own state.
  onCancel: () => void;
};

export function useBoardTouchDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  callbacks: BoardTouchDragCallbacks,
) {
  // Latest-callbacks ref: the listeners attach once, but the board re-renders
  // mid-drag (setDragId/setOverCol), so the handlers must call the freshest
  // closures — which see the freshest drop() and component state.
  const cb = useRef(callbacks);
  useEffect(() => {
    cb.current = callbacks;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Per-gesture state in closures (no re-render, no stale reads).
    let touchId: number | null = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let armed = false;
    let cardId: string | null = null;
    let cardEl: HTMLElement | null = null;
    let overCol: string | null = null;
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
      overCol = null;
    }

    function columnRects(): ColumnRect[] {
      const rects: ColumnRect[] = [];
      el!.querySelectorAll<HTMLElement>("[data-col]").forEach((c) => {
        const col = c.dataset.col;
        if (col == null) return;
        const r = c.getBoundingClientRect();
        rects.push({ col, left: r.left, right: r.right });
      });
      return rects;
    }

    function hitTest() {
      const col = columnAtPoint(columnRects(), lastX);
      if (col !== overCol) {
        overCol = col;
        cb.current.onOver(col);
      }
    }

    // A pointer-events-none clone of the lifted card, fixed to the viewport and
    // following the finger. Cloned from the live node so it matches exactly.
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

    // Runs every frame while armed; scrolls only when the finger is in an edge
    // zone, then re-hit-tests because the columns slid under a held finger.
    function autoScrollTick() {
      if (!armed) {
        raf = null;
        return;
      }
      const br = el!.getBoundingClientRect();
      let scrolled = false;
      const left = edgeAutoScrollVelocity(lastX - br.left);
      const right = edgeAutoScrollVelocity(br.right - lastX);
      if (left > 0) {
        el!.scrollLeft -= left;
        scrolled = true;
      } else if (right > 0) {
        el!.scrollLeft += right;
        scrolled = true;
      }
      const up = edgeAutoScrollVelocity(lastY);
      const down = edgeAutoScrollVelocity(window.innerHeight - lastY);
      if (up > 0) {
        window.scrollBy(0, -up);
        scrolled = true;
      } else if (down > 0) {
        window.scrollBy(0, down);
        scrolled = true;
      }
      if (scrolled) hitTest();
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
      if (touchId != null) return; // already tracking a finger; ignore extras
      const li = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-card-id]",
      );
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
        navigator.vibrate?.(10); // haptic "lifted" cue; no-op where unsupported
        cb.current.onArm(cardId);
      }, LONG_PRESS_MS);
    }

    function onTouchMove(e: TouchEvent) {
      const t = trackedTouch(e);
      if (!t) return;
      if (!armed) {
        // Pre-arm movement = scrolling/swiping, not a hold-to-drag. Bail and
        // let the browser scroll natively.
        if (
          exceedsMoveThreshold(
            { x: startX, y: startY },
            { x: t.clientX, y: t.clientY },
          )
        ) {
          reset();
        }
        return;
      }
      // Armed: we own the gesture — stop the page/board from scrolling.
      e.preventDefault();
      lastX = t.clientX;
      lastY = t.clientY;
      positionGhost();
      hitTest();
    }

    function onTouchEnd(e: TouchEvent) {
      if (!trackedTouch(e)) return;
      if (armed) {
        // Suppress the synthetic click so the card's <Link> doesn't navigate.
        e.preventDefault();
        cb.current.onDrop(overCol);
      }
      reset();
    }

    function onTouchCancel(e: TouchEvent) {
      if (!trackedTouch(e)) return;
      const wasArmed = armed;
      reset();
      if (wasArmed) cb.current.onCancel();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      reset();
    };
  }, [containerRef]);
}
