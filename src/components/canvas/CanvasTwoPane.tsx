"use client";

// A two-pane canvas shell shared by the bespoke item canvases (ADR-158): the
// primary content on the left, a context rail on the right. It splits into two
// columns on CONTAINER width, not viewport (`@container` + `@min-[640px]:`), so
// it shows the dual column wherever there's room — the full page AND the
// intercepted modal peek (Brandon views items in the modal most of the time) —
// and stacks gracefully when the container is narrow (a tight modal, a phone
// sheet). The rail is sticky and scrolls independently; the pane boundary carries
// a sticky collapse chevron, and collapsing turns the whole right-edge gutter
// into a set-off, full-height reopen target. When `resizable`, the boundary is
// also a drag handle. Width + open state persist per browser under `storageKey`.
// Both panes are server-rendered and handed in as `main`/`rail` nodes.
//
// NOTE: the `@min-[640px]:` classes are written out in full — Tailwind's scanner
// only detects complete class literals, so they must never be built by string
// interpolation.
import { useEffect, useRef, useState, type ReactNode } from "react";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={dir === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
    </svg>
  );
}

export default function CanvasTwoPane({
  main,
  rail,
  storageKey,
  resizable = true,
  defaultWidth = 360,
  minWidth = 280,
  maxWidth = 620,
}: {
  main: ReactNode;
  rail: ReactNode;
  storageKey: string;
  // When false the boundary is a fixed divider with the collapse chevron only —
  // no drag handle (a compact rail, or inside the modal, which has its own resize
  // on its outer edge — avoids two handles).
  resizable?: boolean;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}) {
  const OPEN_KEY = `ledgr:${storageKey}-rail-open`;
  const WIDTH_KEY = `ledgr:${storageKey}-rail-width`;
  const clamp = (n: number) => Math.min(maxWidth, Math.max(minWidth, Math.round(n)));

  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(defaultWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false);
    if (resizable) {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (w) setWidth(clamp(w));
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  }, [open, ready, OPEN_KEY]);

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    let latest = startW;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => {
      latest = clamp(startW - (ev.clientX - startX));
      setWidth(latest);
    };
    const up = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem(WIDTH_KEY, String(latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const railWidth = resizable ? width : defaultWidth;

  return (
    <div className="@container">
      <div className="flex flex-col @min-[640px]:flex-row @min-[640px]:items-stretch">
        {/* pr at the split clears the collapse chevron, which is centered in the
            thin boundary strip and bleeds a few px toward the main column. */}
        <div className="min-w-0 @min-[640px]:flex-1 @min-[640px]:pr-2">{main}</div>

        {/* Boundary (split + open only): hairline + sticky collapse chevron;
            a drag handle too when resizable. */}
        {open && (
          <div
            {...(resizable
              ? {
                  role: "separator" as const,
                  "aria-orientation": "vertical" as const,
                  "aria-label": "Resize panel",
                  onPointerDown: startDrag,
                }
              : {})}
            className={`group relative hidden w-3 shrink-0 justify-center @min-[640px]:flex ${
              resizable ? "cursor-col-resize" : ""
            }`}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:bg-line-strong" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Hide panel"
              title="Hide panel"
              className="sticky top-4 z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-subtle transition-colors hover:border-line-strong hover:bg-surface-3 hover:text-ink"
            >
              <Chevron dir="right" />
            </button>
          </div>
        )}

        {/* Rail: mobile-first stacked (main, then rail below a hairline); at the
            split width it becomes a sticky side column and the divider drops.
            When collapsed it stays stacked-visible below the split width, and
            hides above it (the gutter reopens it there). */}
        <aside
          style={{ ["--rail-w" as string]: `${railWidth}px` }}
          className={
            open
              ? "min-w-0 mt-4 border-t border-line pt-4 @min-[640px]:mt-0 @min-[640px]:border-t-0 @min-[640px]:pt-0 @min-[640px]:w-[var(--rail-w)] @min-[640px]:shrink-0 @min-[640px]:sticky @min-[640px]:top-4 @min-[640px]:self-start @min-[640px]:max-h-[calc(100vh-1.5rem)] @min-[640px]:overflow-y-auto @min-[640px]:pl-5"
              : "min-w-0 mt-4 border-t border-line pt-4 @min-[640px]:hidden"
          }
        >
          {rail}
        </aside>

        {/* Collapsed gutter (split + collapsed only): the whole right-edge strip
            is the reopen target — set off, brightening on hover, sticky chevron. */}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Show panel"
            title="Show panel"
            className="group hidden w-7 shrink-0 border-l border-line bg-surface-1 transition-colors hover:border-line-strong hover:bg-surface-2 @min-[640px]:block"
          >
            <span className="sticky top-4 z-10 mx-auto flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-subtle transition-colors group-hover:border-line-strong group-hover:bg-surface-3 group-hover:text-ink">
              <Chevron dir="left" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
