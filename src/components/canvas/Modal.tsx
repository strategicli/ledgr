// Chrome for the intercepted item route (PRD §4.13). Two shapes, chosen at
// render time from the available content width (ui-refresh S2b):
//   - PEEK  — a panel docked to the trailing (right) edge of the content region
//             when there's room (≥1280px of content, measured inside the nav
//             frame) and the nav isn't docked on the right. Non-modal: the list
//             stays visible and interactive underneath, ↑/↓ walk its rows with
//             the peek following, Enter/click a row re-navigates.
//   - CENTER — the original center modal, used when the window is narrow or a
//             right rail already occupies the trailing edge.
// Close = Esc, backdrop click (center only), or ✕ — all return to the surface
// the peek was launched from, collapsing any intra-peek item-to-item hops (arrow
// walk uses replace and adds no history; clicking a live list row underneath
// pushes, so we count those pushes and step back over all of them at once).
// Expand is a plain anchor (hard navigation) so the same URL re-renders as the
// full page form.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";
import ItemActionsMenu from "@/components/canvas/ItemActionsMenu";
import ActionGlyph from "@/components/canvas/action-icons";
import TypeCue from "@/components/canvas/TypeCue";

// The content region must be at least this wide (px, inside the nav frame) for
// the peek panel; below it the center modal is the better use of space. Matches
// the brief's ≥1280px-of-content threshold.
const PEEK_MIN_CONTENT = 1280;

// Decide the shape from the live layout. Reads the body's resolved padding —
// globals.css turns the nav's --nav-pl/pr vars into real padding at sm+, so
// paddingLeft/Right ARE the docked rail widths. A right rail (paddingRight > 0)
// means the trailing edge is taken, so we fall back to the center modal there
// (and under any future right/split config) exactly as the brief specifies.
// Below this viewport width the item view is a bottom sheet (ui-refresh S6),
// matching the sm breakpoint the nav uses to switch to the floating bar.
const SHEET_MAX = 640;

type Mode = "sheet" | "peek" | "center";

function computeMode(): Mode {
  if (typeof window === "undefined") return "center";
  if (window.innerWidth < SHEET_MAX) return "sheet";
  const cs = getComputedStyle(document.body);
  const pl = parseFloat(cs.paddingLeft) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const content = window.innerWidth - pl - pr;
  const rightRail = pr > 8; // a real right-docked rail, not sub-pixel noise
  return content >= PEEK_MIN_CONTENT && !rightRail ? "peek" : "center";
}

function isTyping(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  );
}

export default function Modal({
  itemId,
  children,
  wide = false,
  title = "",
  type = "",
  typeLabel = "",
  typeIcon = null,
  isTemplate = false,
  locked = false,
  favorited = false,
}: {
  itemId: string;
  children: React.ReactNode;
  // Wider panel for canvases that need the room (a song's two-column chart);
  // the default keeps note/task previews compact.
  wide?: boolean;
  // For the actions menu's "Save as template" default name; and to swap chrome
  // on a template prototype (its delete is the registry-aware banner action, not
  // the generic item Trash, which would orphan the registry row) — ADR-093 TPL2.
  title?: string;
  // The item's type, for the actions menu's "Apply template…" picker (TPL4b).
  type?: string;
  // The type's human label + nav icon, for the quiet type cue beside "Trash"
  // (ADR-132). Resolved by the modal page; empty label hides the cue.
  typeLabel?: string;
  typeIcon?: string | null;
  isTemplate?: boolean;
  // Whether the item is locked (items.properties.locked) — drives the menu's
  // lock/unlock label.
  locked?: boolean;
  // Whether the item is in the owner's favorites — drives the menu's star label.
  favorited?: boolean;
}) {
  const router = useRouter();
  // How many extra history entries the peek has pushed since it opened. The
  // initial launch (list → this item) is always one entry, so closing steps
  // back `1 + pushCount` to land on the launching surface, collapsing any
  // item-to-item navigation. Arrow-walk uses router.replace (no new entry, so
  // it isn't counted); clicking another row in the live list underneath is a
  // Next <Link> push, which is.
  const pushCount = useRef(0);
  const walking = useRef(false);
  const prevId = useRef(itemId);
  useEffect(() => {
    if (prevId.current === itemId) return;
    if (!walking.current) pushCount.current += 1;
    walking.current = false;
    prevId.current = itemId;
  }, [itemId]);
  const close = useCallback(() => {
    const steps = 1 + pushCount.current;
    if (typeof window !== "undefined" && window.history.length > steps) {
      window.history.go(-steps);
    } else {
      router.back();
    }
  }, [router]);
  // sheet (mobile) / peek (wide desktop) / center — decided from the layout on
  // mount and kept current on resize. Client-only guard makes the SSR pass
  // (never hit in practice — the @modal slot only fills on a client nav) fall
  // to center.
  const [mode, setMode] = useState<Mode>(computeMode);
  const peek = mode === "peek";
  // Drag-to-dismiss offset for the bottom sheet (px the sheet is pulled down).
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);
  // The sheet's scroll container, so a body drag can tell whether the content is
  // at its top before it decides to dismiss vs. scroll.
  const bodyRef = useRef<HTMLDivElement>(null);
  // Whether the in-progress drag is allowed to dismiss: true for a header drag
  // (chrome), and for a body drag only while the content is at the top.
  const canDismiss = useRef(false);
  const dragFromBody = useRef(false);

  useEffect(() => {
    const onResize = () => setMode(computeMode());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Lock the page scroll behind a full overlay (sheet or center modal), so a
  // drag on/near the sheet can't scroll the list underneath — the "main page
  // scrolls while I'm aiming at the drawer" report. Peek is non-modal (the list
  // stays live and walkable), so it deliberately does NOT lock. Locking the
  // <html> element (not body) leaves the sheet's own inner scroll container free.
  useEffect(() => {
    if (peek) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = prev;
    };
  }, [peek]);

  // Walk the list rows with ↑/↓ while the peek is open. Both the list (in the
  // page's <main>) and this panel (in the @modal slot) share one document, so we
  // read the list's ordered /items links straight from the DOM and router.replace
  // to the sibling row — the intercepted route re-renders the peek in place, and
  // replace (not push) keeps a single Back to the list. Suppressed while typing
  // in the editor so arrows still move the caret.
  const walk = useCallback(
    (delta: number) => {
      // Prefer the marked row-title links so the walk skips secondary /items
      // anchors in a row (the linked-item chip added in S2). Fall back to every
      // /items link for lists that don't mark their rows yet.
      let links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('main a[data-peek-row][href^="/items/"]')
      );
      if (links.length === 0) {
        links = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('main a[href^="/items/"]')
        );
      }
      const hrefs: string[] = [];
      for (const a of links) {
        const h = a.getAttribute("href");
        if (h && !hrefs.includes(h)) hrefs.push(h);
      }
      if (hrefs.length === 0) return;
      const cur = hrefs.findIndex((h) => h === `/items/${itemId}`);
      const next = cur === -1 ? 0 : cur + delta;
      if (next < 0 || next >= hrefs.length) return;
      // A replace adds no history entry, so flag it before it fires: the itemId
      // effect that runs on the resulting re-render must not count it as a push.
      walking.current = true;
      router.replace(hrefs[next], { scroll: false });
    },
    [itemId, router]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // BlockNote popovers (slash menu, mention picker) consume their own
      // Escape and prevent default; only an unclaimed Esc closes.
      if (e.key === "Escape" && !e.defaultPrevented) {
        close();
        return;
      }
      if (
        peek &&
        !e.defaultPrevented &&
        !isTyping(e.target) &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        e.preventDefault();
        walk(e.key === "ArrowDown" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, peek, walk]);

  // Center modal owns the scroll context (one panel); the peek is non-modal, so
  // the list underneath must keep scrolling — only lock the body in center mode.
  useEffect(() => {
    if (peek) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [peek]);

  // Title/field edits made here must show in the list underneath the moment it
  // closes; refresh-on-unmount runs after back() lands.
  useEffect(() => {
    return () => router.refresh();
  }, [router]);

  // The shared header (Trash · type cue · actions · Expand · Close) and the
  // scrolling canvas body, kept separate so the sheet can make ONLY the header
  // its drag-to-dismiss zone (the body must scroll + text-select freely).
  const header = (
      <div className="flex shrink-0 items-center justify-between gap-1 px-3 pt-2">
        <div className="flex items-center gap-1">
          {/* A template prototype's destructive/templatize actions live in its
              canvas banner (registry-aware); the generic item chrome is hidden. */}
          {!isTemplate && (
            <ConfirmButton
              title="Move to Trash?"
              description="This item moves to Trash and can be recovered for 30 days."
              confirmLabel="Trash"
              trigger={<ActionGlyph icon="trash" />}
              triggerLabel="Move to Trash"
              triggerClassName="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
              align="left"
              onConfirm={async () => {
                const res = await fetch(`/api/items/${itemId}`, { method: "DELETE" });
                if (!res.ok) throw new Error(`Failed (${res.status})`);
                close();
              }}
            />
          )}
          {/* Quiet type cue beside Trash (ADR-132): no extra vertical space. */}
          {!isTemplate && typeLabel && (
            <TypeCue icon={typeIcon} label={typeLabel} className="px-1" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Save as template, Apply template, Customize layout, and the lock
              toggle all live behind the "⋯" menu (a template's are hidden). */}
          {!isTemplate && (
            <ItemActionsMenu
              itemId={itemId}
              type={type}
              title={title}
              locked={locked}
              favorited={favorited}
            />
          )}
          {/* Plain <a>, not <Link>: a soft nav to the same URL would stay
              intercepted; a document load renders the full page form. */}
          <a
            href={`/items/${itemId}`}
            className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            title="Expand to full page"
          >
            ⤢ Expand
          </a>
          <button
            onClick={close}
            aria-label="Close"
            className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>
  );
  const bodyClass = "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-12";
  const body = <div className={bodyClass}>{children}</div>;
  const panel = (
    <>
      {header}
      {body}
    </>
  );

  if (mode === "sheet") {
    // Bottom sheet (mobile). Drag down to dismiss: from the grabber/header
    // anywhere, or from the body when it's scrolled to the top. Mid-scroll body
    // drags scroll normally (scrollTop guard), so the editor still scrolls and
    // text-selects freely.
    const onDragStart = (e: React.TouchEvent, fromBody: boolean) => {
      dragStart.current = e.touches[0].clientY;
      dragFromBody.current = fromBody;
      // Header drag always dismisses (it's chrome); a body drag only when the
      // content is already at its top — otherwise it's a scroll. Mirrors
      // Launcher.tsx's scrollTop guard, no gesture fight.
      canDismiss.current = !fromBody || (bodyRef.current?.scrollTop ?? 0) <= 0;
      setDragging(true);
    };
    const onDragMove = (e: React.TouchEvent) => {
      if (dragStart.current == null || !canDismiss.current) return;
      // If a body drag scrolled away from the top mid-gesture, hand it back to
      // the scroller instead of dismissing.
      if (dragFromBody.current && (bodyRef.current?.scrollTop ?? 0) > 0) return;
      const dy = e.touches[0].clientY - dragStart.current;
      // Downward only: the sheet follows the finger toward the bottom of the
      // screen; an upward drag from the top just scrolls the content.
      if (dy > 0) setDragY(dy);
    };
    const onDragEnd = () => {
      if (dragY > 120) close();
      else setDragY(0);
      dragStart.current = null;
      canDismiss.current = false;
      dragFromBody.current = false;
      setDragging(false);
    };
    return (
      <div className="fixed inset-0 z-50 bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div
          role="dialog"
          aria-label={title || "Item"}
          className="fixed inset-x-0 bottom-0 flex max-h-[92vh] flex-col overflow-hidden rounded-t-2xl border-t border-line-strong bg-[var(--background)] shadow-2xl shadow-black/50"
          // Only take on a transform while actually dragging. A resting
          // `translateY(0px)` is still a transform, which makes this sheet the
          // containing block for any `position: fixed` descendant — that traps
          // the editor's mobile formatting toolbar (fixed, pinned above the
          // keyboard) inside the sheet so it can't anchor to the viewport. At
          // rest we drop the transform entirely; the drag/close path is
          // unaffected (you're never typing while dismissing the sheet).
          style={{
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragging ? "none" : "transform 0.2s ease",
          }}
        >
          {/* Grabber + header: always a drag-to-dismiss zone. touch-none keeps the
              browser from treating the downward drag as a page scroll / pull-to-
              refresh (React's touchmove is passive, so preventDefault alone can't)
              — the drag is fully JS-owned here. */}
          <div className="touch-none" onTouchStart={(e) => onDragStart(e, false)} onTouchMove={onDragMove} onTouchEnd={onDragEnd} onTouchCancel={onDragEnd}>
            <div className="flex justify-center pt-2 pb-1">
              <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            </div>
            {header}
          </div>
          {/* Body: scrolls and text-selects freely. When it's already at the top,
              a downward drag here also slides the sheet closed (scrollTop guard in
              onDragStart/onDragMove), so the whole sheet — not just the grabber —
              can be flicked away; mid-scroll drags still scroll. Not touch-none:
              it must keep its native scroll. */}
          <div
            ref={bodyRef}
            className={bodyClass}
            onTouchStart={(e) => onDragStart(e, true)}
            onTouchMove={onDragMove}
            onTouchEnd={onDragEnd}
            onTouchCancel={onDragEnd}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  if (peek) {
    // Docked to the trailing edge of the content region: top/bottom clear a
    // top/bottom bar, right clears a right rail (0 here since a right rail forces
    // center). Non-modal — no backdrop, so the list stays live underneath.
    return (
      <div
        role="dialog"
        aria-label={title || "Item"}
        className="fixed z-40 flex flex-col overflow-hidden border-l border-line-strong bg-surface-2 shadow-2xl shadow-black/50"
        style={{
          top: "var(--nav-pt, 0px)",
          bottom: "var(--nav-pb, 0px)",
          right: "var(--nav-pr, 0px)",
          // Non-wide holds the ~48rem canvas column comfortably (up from 34rem,
          // which squished it); wide (song chord charts) stays roomier. The vw
          // cap keeps it responsive — it shrinks with the window, and the peek
          // only activates at ≥1280px of content (PEEK_MIN_CONTENT).
          width: wide ? "min(60rem, 50vw)" : "min(52rem, 46vw)",
        }}
      >
        {panel}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 py-3 sm:px-6 sm:py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-neutral-800 bg-[var(--background)] shadow-2xl ${
          wide ? "max-w-5xl" : "max-w-3xl"
        }`}
      >
        {panel}
      </div>
    </div>
  );
}
