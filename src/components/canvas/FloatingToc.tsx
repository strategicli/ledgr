// Floating table of contents (ADR-114): a Notion-style outline built from the
// item body's headings, universal across every canvas type because it mounts
// once in ItemCanvas. One engine, two presentations:
//   - desktop / wide page  → a thin right-edge rail of marks that expands on
//     hover into a clickable, indented heading list (pure CSS group-hover).
//   - phone / narrow / modal → a floating round button that opens a bottom sheet
//     of the same list (tap a heading to jump + close).
// The engine reads the live editor DOM (.ledgr-prose), so the outline tracks
// edits as you type, and drives scroll + active-section tracking against whatever
// actually scrolls — the window on the full page, the modal's own scroll div in
// the intercept modal (getScrollParent). It self-gates: with fewer than two
// headings of the enabled levels, it renders nothing. Heading nodes are never
// mutated (ProseMirror owns that DOM); we re-query live by document order and key
// the list by index.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NavPosition } from "@/lib/settings";

type Heading = { text: string; level: number };

const MIN_HEADINGS = 2;

// Width of a collapsed rail mark and the label indent, per heading level.
const MARK_WIDTH: Record<number, number> = { 1: 18, 2: 13, 3: 9 };
const INDENT_PX: Record<number, number> = { 1: 8, 2: 18, 3: 28 };

// The nearest scrollable ancestor (the modal body); null means the window/page.
function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

// A heading's top relative to the scroll viewport (container top, or 0 = window).
function topWithin(el: HTMLElement, container: HTMLElement | null): number {
  const top = el.getBoundingClientRect().top;
  return container ? top - container.getBoundingClientRect().top : top;
}

function scrollToEl(el: HTMLElement, container: HTMLElement | null, offset: number) {
  if (container) {
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      offset;
    container.scrollTo({ top, behavior: "smooth" });
  } else {
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }
}

export default function FloatingToc({
  variant,
  levels,
  navPosition,
}: {
  variant: "page" | "modal";
  levels: number[];
  navPosition: NavPosition;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const proseRef = useRef<HTMLElement | null>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const offsetRef = useRef(16);

  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // CSS selector for the enabled heading levels, in document order.
  const selector = [...levels]
    .filter((l) => l >= 1 && l <= 3)
    .sort((a, b) => a - b)
    .map((l) => `h${l}`)
    .join(",");

  // Live heading elements (re-queried, never cached as detached nodes), so a
  // jump/active read always targets a node ProseMirror currently owns.
  const liveEls = useCallback((): HTMLElement[] => {
    const prose = proseRef.current;
    if (!prose || !selector) return [];
    return Array.from(prose.querySelectorAll<HTMLElement>(selector));
  }, [selector]);

  // Rebuild the outline from the current DOM. Finds the body editor within this
  // canvas's own scope (critical: when the modal is open, the page canvas is also
  // mounted, so we must read THIS instance's .ledgr-prose, not document's first).
  const rescan = useCallback(() => {
    const scope =
      rootRef.current?.closest<HTMLElement>("[data-toc-scope]") ?? document.body;
    const prose = scope.querySelector<HTMLElement>(".ledgr-prose");
    proseRef.current = prose;
    if (!prose || !selector) {
      setHeadings([]);
      return;
    }
    scrollElRef.current = getScrollParent(prose);
    // Window/page clears the fixed top header (h-14) on sm+; the modal has none.
    offsetRef.current =
      variant === "modal"
        ? 12
        : typeof window !== "undefined" &&
            window.matchMedia("(min-width: 640px)").matches
          ? 72
          : 16;
    const els = Array.from(prose.querySelectorAll<HTMLElement>(selector));
    setHeadings(
      els.map((el) => ({
        text: (el.textContent || "").trim() || "Untitled",
        level: Number(el.tagName.slice(1)) || 1,
      }))
    );
  }, [selector, variant]);

  // Watch this canvas's subtree: catches the (lazy) editor mounting and every
  // heading add/remove/retitle. Debounced — scanning is cheap but edits are bursty.
  useEffect(() => {
    const scope =
      rootRef.current?.closest<HTMLElement>("[data-toc-scope]") ?? document.body;
    let t: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(rescan, 200);
    };
    rescan();
    const mo = new MutationObserver(schedule);
    mo.observe(scope, { childList: true, subtree: true, characterData: true });
    return () => {
      if (t) clearTimeout(t);
      mo.disconnect();
    };
  }, [rescan]);

  // Active-section tracking: the current section is the last heading scrolled
  // past the offset line. Deterministic and flicker-free; rAF-throttled.
  useEffect(() => {
    if (headings.length < MIN_HEADINGS) return;
    const scroller = scrollElRef.current;
    let frame = 0;
    const recompute = () => {
      frame = 0;
      const els = liveEls();
      if (els.length === 0) return;
      let next = 0;
      for (let i = 0; i < els.length; i++) {
        if (topWithin(els[i], scroller) - offsetRef.current <= 1) next = i;
        else break;
      }
      setActive(next);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(recompute);
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    recompute();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [headings.length, liveEls]);

  const jump = useCallback(
    (i: number) => {
      const el = liveEls()[i];
      if (el) scrollToEl(el, scrollElRef.current, offsetRef.current);
    },
    [liveEls]
  );

  // The sentinel always renders so the mount effect can locate the scope even
  // before the editor (and its headings) exist.
  const sentinel = <span ref={rootRef} className="hidden" aria-hidden />;
  if (headings.length < MIN_HEADINGS) return sentinel;

  // Rail sits in the right gutter; nudge it clear of a right-side nav rail.
  const railRight = navPosition === "right" ? "right-20" : "right-4";
  // Page: rail on lg+, button below. Modal: button only (narrow, scroll-contained).
  const railClass = variant === "page" ? "hidden lg:flex" : "hidden";
  const buttonClass = variant === "page" ? "lg:hidden" : "";

  const labelList = (
    <ul className="space-y-0.5">
      {headings.map((h, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => {
              jump(i);
              setSheetOpen(false);
            }}
            style={{ paddingLeft: INDENT_PX[h.level] ?? 8 }}
            className={`block w-full truncate rounded py-1.5 pr-2 text-left text-sm transition-colors ${
              i === active
                ? "bg-[var(--accent)]/15 font-medium text-[var(--accent)]"
                : "text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {sentinel}

      {/* Desktop right-edge rail: marks → hover-expand labels (pure CSS hover). */}
      <nav
        aria-label="Table of contents"
        className={`group fixed top-1/2 z-[45] -translate-y-1/2 ${railRight} ${railClass}`}
      >
        <div className="flex flex-col items-end gap-1.5 py-2 pl-6 transition-opacity duration-150 group-hover:opacity-0">
          {headings.map((h, i) => (
            <span
              key={i}
              style={{ width: MARK_WIDTH[h.level] ?? 9 }}
              className={`h-[3px] rounded-full transition-colors ${
                i === active ? "bg-[var(--accent)]" : "bg-neutral-600"
              }`}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute right-0 top-1/2 max-h-[70vh] w-64 -translate-y-1/2 translate-x-2 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900/95 p-2 opacity-0 shadow-xl shadow-black/40 backdrop-blur transition-all duration-150 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            On this page
          </p>
          {labelList}
        </div>
      </nav>

      {/* Phone / modal: a floating button that opens a bottom sheet. */}
      <button
        type="button"
        aria-label="Table of contents"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen(true)}
        className={`fixed bottom-24 right-4 z-[55] flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/95 text-neutral-200 shadow-lg backdrop-blur transition-colors hover:bg-neutral-800 ${buttonClass}`}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/50"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="max-h-[60vh] overflow-y-auto rounded-t-2xl border-t border-neutral-700 bg-neutral-900 p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-700" />
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              On this page
            </p>
            {labelList}
          </div>
        </div>
      )}
    </>
  );
}
