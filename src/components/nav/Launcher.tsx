// The pull-up launcher grid (ui-refresh S6, ADR-142). The fixed mobile bottom
// bar holds only the owner's daily ~5 destinations; everything else — the full
// nav set plus Search, Build, Settings, Trash — lives here, one swipe/tap up, in
// a fixed spatial grid that's more memorizable than a horizontally scrolling
// strip. Nothing from the old scrolling bar leaves reach; it just moves into a
// surface that shows it all at once. A bottom sheet with a grabber + backdrop,
// drag-down or tap-outside to dismiss (mirrors the item-view sheet, S6). No
// dependency (Principle 5).
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/nav/NavGlyphs";
import { badgeCount } from "@/lib/format-count";

export type LauncherTile = {
  label: string;
  href: string;
  icon: string;
  count?: number | null;
};

export default function Launcher({
  open,
  onClose,
  tiles,
  onSearch,
}: {
  open: boolean;
  onClose: () => void;
  tiles: LauncherTile[];
  // A tile with href "/search" opens the command palette instead of navigating.
  onSearch: () => void;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);

  const onStart = (e: React.TouchEvent) => {
    // Swipe-down-to-dismiss from ANYWHERE on the sheet, but only arm it when the
    // tile list is scrolled to the top — otherwise a downward drag is the user
    // scrolling the list back up, not dismissing (the scrollTop===0 guard so the
    // two gestures never fight). Mirrors the item-view sheet's discipline.
    if ((sheet.current?.scrollTop ?? 0) > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0].clientY;
    setDragging(true);
  };
  const onMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    // Downward only: translate the sheet and swallow the scroll so the list
    // doesn't rubber-band while we're pulling down to dismiss.
    if (dy > 0) {
      setDragY(dy);
      e.preventDefault();
    }
  };
  const onEnd = () => {
    if (dragY > 100) onClose();
    else setDragY(0);
    startY.current = null;
    setDragging(false);
  };

  // Lock the page scroll behind the drawer while it's open, so a drag on the
  // drawer can't scroll the page underneath. Locks <html> (not body) so the
  // drawer's own inner scroll still works.
  useEffect(() => {
    if (!open) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] bg-black/60 sm:hidden"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={sheet}
        role="dialog"
        aria-label="All destinations"
        className="fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line-strong bg-[var(--background)] pb-8 shadow-2xl shadow-black/50"
        style={{ transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 0.2s ease" }}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
      >
        <div>
          <div className="flex justify-center pt-2 pb-1">
            <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
          </div>
          <div className="ui-section-label px-5 pb-2 pt-1">Go to</div>
        </div>
        <div className="grid grid-cols-4 gap-1 px-3">
          {tiles.map((t) =>
            t.href === "/search" ? (
              <button
                key={t.href}
                type="button"
                onClick={() => {
                  onClose();
                  onSearch();
                }}
                className="flex flex-col items-center gap-1.5 rounded-card px-1 py-3 text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon icon={t.icon} />
                <span className="w-full truncate text-center text-[11px]">{t.label}</span>
              </button>
            ) : (
              <Link
                key={t.href}
                href={t.href}
                onClick={onClose}
                className="relative flex flex-col items-center gap-1.5 rounded-card px-1 py-3 text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <span className="relative inline-flex">
                  <Icon icon={t.icon} />
                  {t.count != null && t.count > 0 && (
                    <span
                      className="absolute -right-2 -top-1 rounded-full px-1 text-[9px] font-medium leading-tight text-white"
                      style={{ background: "var(--accent-gradient, var(--accent))" }}
                    >
                      {badgeCount(t.count)}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-[11px]">{t.label}</span>
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}
