// The client nav chrome (v6 redesign). One set of slots + a "+ New" quick
// capture + a "More" kebab, rendered four ways by the owner's navPosition:
//
//   • bottom  — a floating pill, centered on the bottom edge (also the mobile
//               default on every position).
//   • top     — a full-width docked menu bar across the top.
//   • left /  — a full-height docked side rail with three sizes the collapse
//     right     arrow cycles: fat (icons + names) → thin (icons only) →
//               hidden (a reopen tab at the edge). The kebab uses horizontal
//               dots on the rail.
//
// Search is a command-palette modal (Ctrl/Cmd+K); Build has a global shortcut
// (Ctrl/Cmd+Shift+B) and a highlighted, glowing entry in the More menu. The
// owner's navPosition + railSize arrive as props (the layout reads them
// server-side and pads the body to match); the rail collapse updates both the
// body padding and the persisted setting on the fly.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CaptureModal from "@/components/capture/CaptureModal";
import SearchModal from "@/components/search/SearchModal";
import { RAIL_PX } from "@/lib/nav-layout";
import type { NavDensity, NavPosition, RailAnchor, RailSize } from "@/lib/settings";

export type ShellSlot = {
  key: string;
  label: string;
  href: string;
  count: number | null;
};

// Hand-rolled 20px stroke icons; an icon library for a handful of glyphs would
// be a dependency we don't need (Principle 5).
function Icon({ slot }: { slot: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (slot) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...common}>
          <path d="M3 13h5l1.5 2.5h5L16 13h5" />
          <path d="M4.5 6.5h15L21 13v6H3v-6l1.5-6.5Z" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="m8.5 12.5 2.5 2.5 4.5-5" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      );
    case "views": // distinct from items: a stack of saved slices
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="6" rx="1.5" />
          <rect x="4" y="14" width="16" height="6" rx="1.5" />
        </svg>
      );
    default: // items / anything else: a list
      return (
        <svg {...common}>
          <path d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="4" cy="6" r="0.5" />
          <circle cx="4" cy="12" r="0.5" />
          <circle cx="4" cy="18" r="0.5" />
        </svg>
      );
  }
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.2l-5.1 5.1a1.5 1.5 0 0 0 2.1 2.1l5.1-5.1a3.5 3.5 0 0 0 4.2-4.6l-2 2-1.7-1.7 2-2Z" />
    </svg>
  );
}

// "Back to Work" leaves the Build surface — an arrow returning to a workspace,
// distinct from Build's wrench.
function BackToWorkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 4 12l7 7" />
      <path d="M4 12h12.5a3.5 3.5 0 0 1 3.5 3.5V19" />
    </svg>
  );
}

// The Ledgr wordmark; --font-logo is set on <html> by the layout. The full
// mark ends its "r" in the accent for a small brand touch; the compact mark
// (thin rail, where the wordmark won't fit) is a single accented "L".
function Logo({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Ledgr home"
      className={`shrink-0 px-1 font-bold tracking-tight text-neutral-100 ${
        compact ? "text-base" : "text-lg"
      } ${className}`}
      style={{ fontFamily: "var(--font-logo), var(--font-geist-sans)" }}
    >
      {compact ? <span className="text-[var(--accent)]">L</span> : <>Ledg<span className="text-[var(--accent)]">r</span></>}
    </Link>
  );
}

// Vertical dots for top/bottom, horizontal for the side rail (v6).
function KebabIcon({ horizontal }: { horizontal: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      {horizontal ? (
        <>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </>
      ) : (
        <>
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </>
      )}
    </svg>
  );
}

function Chevron({ dir, size = 16 }: { dir: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <path d="m14 6-6 6 6 6" /> : <path d="m10 6 6 6-6 6" />}
    </svg>
  );
}

function CornerBadge({ count }: { count: number | null }) {
  if (count == null || count <= 0) return null;
  return (
    <span className="absolute right-1 top-0.5 rounded-full bg-[var(--accent)] px-1.5 py-px text-[10px] font-medium leading-tight text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function InlineBadge({ count }: { count: number | null }) {
  if (count == null || count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 py-px text-[10px] font-medium leading-tight text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const POSITIONS: { value: NavPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

// The collapse arrow steps fat → thin → hidden → fat.
const NEXT_RAIL: Record<RailSize, RailSize> = { fat: "thin", thin: "hidden", hidden: "fat" };
const RAIL_NEXT_LABEL: Record<RailSize, string> = {
  fat: "Collapse to icons",
  thin: "Hide menu",
  hidden: "Show menu",
};

export default function NavShell({
  slots,
  typeOptions,
  navPosition,
  railSize: railSizeProp,
  navDensity: navDensityProp,
  railAnchor: railAnchorProp,
}: {
  slots: ShellSlot[];
  typeOptions: { key: string; label: string }[];
  navPosition: NavPosition;
  railSize: RailSize;
  navDensity: NavDensity;
  railAnchor: RailAnchor;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [railSize, setRailSize] = useState<RailSize>(railSizeProp);
  const [density, setDensity] = useState<NavDensity>(navDensityProp);
  const [anchor, setAnchor] = useState<RailAnchor>(railAnchorProp);

  const isRail = navPosition === "left" || navPosition === "right";
  const inBuild = pathname.startsWith("/build") || pathname.startsWith("/views");

  // Re-adopt server values if a refresh changes them (adjust-during-render
  // pattern; an effect would double-render).
  const [prevRailProp, setPrevRailProp] = useState(railSizeProp);
  if (railSizeProp !== prevRailProp) {
    setPrevRailProp(railSizeProp);
    setRailSize(railSizeProp);
  }
  const [prevDensityProp, setPrevDensityProp] = useState(navDensityProp);
  if (navDensityProp !== prevDensityProp) {
    setPrevDensityProp(navDensityProp);
    setDensity(navDensityProp);
  }
  const [prevAnchorProp, setPrevAnchorProp] = useState(railAnchorProp);
  if (railAnchorProp !== prevAnchorProp) {
    setPrevAnchorProp(railAnchorProp);
    setAnchor(railAnchorProp);
  }

  // Keep the body's side padding in lock-step with the rail width so the
  // collapse feels instant (the CSS transition on body smooths it). Only the
  // docked side that's actually in use is touched.
  useEffect(() => {
    if (!isRail) return;
    const prop = navPosition === "left" ? "--nav-pl" : "--nav-pr";
    document.body.style.setProperty(prop, `${RAIL_PX[railSize]}px`);
  }, [isRail, navPosition, railSize]);

  // Shortcuts: q = quick capture, Ctrl/Cmd+K = search palette, Ctrl/Cmd+Shift+B
  // = Build. q/B stay inert while typing.
  useEffect(() => {
    function typing(t: EventTarget | null) {
      return (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        router.push(inBuild ? "/" : "/build");
      } else if (e.key === "q" && !mod && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        setCaptureOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, inBuild]);

  // Close the More menu on an outside click. Two kebabs can be in the DOM
  // (mobile pill + desktop chrome); match either via the data attribute rather
  // than a single ref.
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (!(e.target as Element).closest?.("[data-nav-kebab]")) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const move = async (pos: NavPosition) => {
    setMenuOpen(false);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navPosition: pos }),
    }).catch(() => {});
    router.refresh();
  };

  const persistSettings = (patch: Record<string, unknown>) => {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  };

  // Cycle the rail size. Local state flips immediately (the body-padding effect
  // follows); the setting persists in the background, no refresh needed.
  const cycleRail = (to?: RailSize) => {
    const next = to ?? NEXT_RAIL[railSize];
    setRailSize(next);
    persistSettings({ railSize: next });
  };

  // Density (+ rail anchor) chooser. Like the rail size, it flips local state
  // instantly and persists in the background.
  const chooseDensity = (d: NavDensity, a?: RailAnchor) => {
    setDensity(d);
    const patch: Record<string, unknown> = { navDensity: d };
    if (a) {
      setAnchor(a);
      patch.railAnchor = a;
    }
    persistSettings(patch);
  };

  // Search moves to the end, next to New (v5).
  const orderedSlots = [
    ...slots.filter((s) => s.key !== "search"),
    ...slots.filter((s) => s.key === "search"),
  ];

  // One slot renderer for every layout: className, whether the label shows, and
  // how the count badge sits (inline alongside a label, or in the corner for
  // icon-only / stacked layouts). Search is a button (opens the palette); the
  // rest are links.
  function renderSlot(
    slot: ShellSlot,
    className: string,
    showLabel: boolean,
    badge: "corner" | "inline"
  ) {
    const inner = (
      <>
        <Icon slot={slot.key} />
        {showLabel && <span className="truncate">{slot.label}</span>}
        {badge === "inline" ? <InlineBadge count={slot.count} /> : <CornerBadge count={slot.count} />}
      </>
    );
    if (slot.key === "search") {
      return (
        <button
          key={slot.key}
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          title="Search (⌘K)"
          className={className}
        >
          {inner}
        </button>
      );
    }
    return (
      <Link
        key={slot.key}
        href={slot.href}
        aria-label={slot.label}
        aria-current={isActive(slot.href) ? "page" : undefined}
        className={className}
      >
        {inner}
      </Link>
    );
  }

  const itemColors = (active: boolean) =>
    active
      ? "bg-neutral-800 text-neutral-100"
      : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200";

  const densityBtn = (active: boolean) =>
    `rounded px-2 py-1 text-xs ${
      active ? "bg-neutral-700 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800"
    }`;

  // Per-layout class builders.
  const pillSlot = (active: boolean) =>
    `relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] ${
      active ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
    }`;
  const topSlot = (active: boolean) =>
    `relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${itemColors(active)}`;
  const railFatSlot = (active: boolean) =>
    `relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${itemColors(active)}`;
  const railThinSlot = (active: boolean) =>
    `relative flex items-center justify-center rounded-lg p-2.5 ${itemColors(active)}`;

  // The shared More dropdown. `posClass` anchors it relative to the kebab; the
  // Build entry is the highlighted, glowing primary action.
  const renderMenu = (posClass: string) => (
    <div
      role="menu"
      className={`absolute z-50 max-h-[calc(100vh-1rem)] w-48 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl shadow-black/50 ${posClass}`}
    >
      <Link
        href={inBuild ? "/" : "/build"}
        role="menuitem"
        onClick={() => setMenuOpen(false)}
        className="mb-1 flex items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/15 px-2.5 py-2 text-sm font-semibold text-[var(--accent)] shadow-[0_0_16px_-3px_var(--accent)] transition hover:bg-[var(--accent)]/25"
      >
        {inBuild ? <BackToWorkIcon /> : <WrenchIcon />}
        {inBuild ? "Back to Work" : "Build"}
      </Link>
      <Link href="/settings" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
        User Settings
      </Link>
      <Link href="/trash" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
        Trash
      </Link>
      <Link href="/changelog" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
        Changelog
      </Link>
      <div className="my-1 border-t border-neutral-800" />
      <p className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">Move menu</p>
      <div className="grid grid-cols-2 gap-1 p-1">
        {POSITIONS.map((p) => (
          <button
            key={p.value}
            onClick={() => void move(p.value)}
            className={`rounded px-2 py-1 text-xs ${
              navPosition === p.value ? "bg-neutral-700 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Density (+ rail anchor). Hidden for the bottom bar, which is always
          compact. Rails get the three-way Spread / Compact-top / Compact-bottom
          choice; the top bar gets Compact (40rem) vs Spread (full width). */}
      {navPosition !== "bottom" && (
        <>
          <p className="px-2 pt-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
            Spacing
          </p>
          {isRail ? (
            <div className="grid grid-cols-1 gap-1 p-1">
              <button
                onClick={() => chooseDensity("spread")}
                className={densityBtn(density === "spread")}
              >
                Spread
              </button>
              <button
                onClick={() => chooseDensity("compact", "top")}
                className={densityBtn(density === "compact" && anchor === "top")}
              >
                Compact (top)
              </button>
              <button
                onClick={() => chooseDensity("compact", "center")}
                className={densityBtn(density === "compact" && anchor === "center")}
              >
                Compact (center)
              </button>
              <button
                onClick={() => chooseDensity("compact", "bottom")}
                className={densityBtn(density === "compact" && anchor === "bottom")}
              >
                Compact (bottom)
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 p-1">
              <button
                onClick={() => chooseDensity("compact")}
                className={densityBtn(density === "compact")}
              >
                Compact
              </button>
              <button
                onClick={() => chooseDensity("spread")}
                className={densityBtn(density === "spread")}
              >
                Spread
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  // The floating pill (mobile on every position; desktop when navPosition is
  // bottom). Identical to the v5 bar.
  // `fill` widens the desktop bottom bar to the ~40rem canvas width and spreads
  // its items across, so it reads with the same presence as the other layouts.
  const floatingPill = (extraClass: string, fill = false) => (
    <div
      className={`fixed z-40 flex items-center rounded-2xl border border-neutral-800 bg-neutral-900/95 shadow-xl shadow-black/40 backdrop-blur ${
        fill ? "w-[40rem] max-w-[calc(100vw-2rem)] justify-between gap-1 p-2 [&_svg]:h-6 [&_svg]:w-6" : "gap-1 p-1.5"
      } ${extraClass}`}
    >
      {orderedSlots.map((slot) =>
        renderSlot(slot, pillSlot(slot.key !== "search" && isActive(slot.href)), true, "corner")
      )}
      <button
        onClick={() => setCaptureOpen(true)}
        title="Quick capture (q)"
        className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] text-[var(--accent)] hover:bg-neutral-800/60"
      >
        <PlusIcon />
        New
      </button>
      <div data-nav-kebab className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
        >
          <KebabIcon horizontal={false} />
          More
        </button>
        {menuOpen && renderMenu("right-0 bottom-full mb-2")}
      </div>
    </div>
  );

  return (
    <nav aria-label="Main">
      {/* Mobile: always the floating bottom bar, whatever the desktop position. */}
      <div className="sm:hidden">
        {floatingPill("bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2")}
      </div>

      {/* Desktop chrome (sm+). One of four layouts. */}
      {navPosition === "bottom" && (
        <div className="hidden sm:block">
          {floatingPill("bottom-4 left-1/2 -translate-x-1/2", true)}
        </div>
      )}

      {navPosition === "top" && (
        // The bar always spans the full top edge (background + border line all
        // the way across), like the rails span the full height. Compact centers
        // the *content* within a ~40rem band (mx-auto); spread lets it use the
        // full width. Inside both: logo + items left, New/More right (ml-auto).
        <header className="fixed inset-x-0 top-0 z-40 hidden h-14 border-b border-neutral-800 bg-neutral-900/95 backdrop-blur sm:block">
          {/* Compact uses the SAME container as the page content (mx-auto
              max-w-3xl px-6 sm:px-12, see app/page.tsx) so the logo lines up
              with the page heading and New/More align with the content's right
              edge. Spread spreads across the full width. */}
          <div
            className={`mx-auto flex h-full items-center gap-1 ${
              density === "compact" ? "w-full max-w-3xl px-6 sm:px-12" : "px-3"
            }`}
          >
            <Logo className="-ml-1" />
            {orderedSlots.map((slot) =>
              renderSlot(slot, topSlot(slot.key !== "search" && isActive(slot.href)), true, "inline")
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setCaptureOpen(true)}
                title="Quick capture (q)"
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:bg-neutral-800/60"
              >
                <PlusIcon />
                New
              </button>
              <div data-nav-kebab className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="Menu"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center rounded-lg p-2 text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
                >
                  <KebabIcon horizontal={false} />
                </button>
                {menuOpen && renderMenu("right-0 top-full mt-2")}
              </div>
            </div>
          </div>
        </header>
      )}

      {isRail && railSize === "hidden" && (
        <button
          onClick={() => cycleRail("fat")}
          aria-label="Show menu"
          title="Show menu"
          className={`fixed top-1/2 z-40 hidden h-16 w-6 -translate-y-1/2 items-center justify-center border border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] shadow-[0_0_16px_-2px_var(--accent)] backdrop-blur transition hover:bg-[var(--accent)]/25 sm:flex ${
            navPosition === "left" ? "left-0 rounded-r-lg border-l-0" : "right-0 rounded-l-lg border-r-0"
          }`}
        >
          <Chevron dir={navPosition === "left" ? "right" : "left"} size={22} />
        </button>
      )}

      {isRail && railSize !== "hidden" && (
        <aside
          className={`fixed inset-y-0 z-40 hidden flex-col gap-1 bg-neutral-900/95 p-2 shadow-xl shadow-black/30 backdrop-blur sm:flex ${
            navPosition === "left" ? "left-0 border-r border-neutral-800" : "right-0 border-l border-neutral-800"
          }`}
          style={{ width: RAIL_PX[railSize] }}
        >
          {/* Top of the rail: Ledgr logo + the collapse arrow (pointing toward
              the docked edge). Fat puts them on one row (logo left, arrow at the
              edge); thin stacks the compact "L" over a centered arrow. */}
          {(() => {
            const collapseArrow = (
              <button
                onClick={() => cycleRail()}
                aria-label={RAIL_NEXT_LABEL[railSize]}
                title={RAIL_NEXT_LABEL[railSize]}
                className="flex items-center justify-center rounded-lg p-1.5 text-[var(--accent)] hover:bg-[var(--accent)]/15"
              >
                <Chevron dir={navPosition === "left" ? "left" : "right"} size={railSize === "fat" ? 16 : 22} />
              </button>
            );
            // Fat: logo on the left, arrow at the docked edge. Thin: just the
            // arrow (no room for even the compact mark), a little larger.
            return railSize === "fat" ? (
              <div className="flex items-center justify-between px-1 pb-1">
                <Logo />
                {collapseArrow}
              </div>
            ) : (
              <div className="flex justify-center pb-1">{collapseArrow}</div>
            );
          })()}

          {/* Spacing via flex-1 spacers around the slots/actions cluster:
              spread → one spacer between them (slots top, utilities bottom);
              compact-top → no spacers; compact-bottom → spacer above; compact-
              center → equal spacers above and below. */}
          {density === "compact" && (anchor === "bottom" || anchor === "center") && (
            <div className="flex-1" />
          )}

          {/* Slots. */}
          <div className="flex flex-col gap-1">
            {orderedSlots.map((slot) =>
              renderSlot(
                slot,
                railSize === "fat"
                  ? railFatSlot(slot.key !== "search" && isActive(slot.href))
                  : railThinSlot(slot.key !== "search" && isActive(slot.href)),
                railSize === "fat",
                railSize === "fat" ? "inline" : "corner"
              )
            )}
          </div>

          {density === "spread" && <div className="flex-1" />}

          {/* New + More. */}
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setCaptureOpen(true)}
              title="Quick capture (q)"
              className={`flex items-center text-[var(--accent)] hover:bg-neutral-800/60 ${
                railSize === "fat" ? "gap-3 rounded-lg px-3 py-2 text-sm" : "justify-center rounded-lg p-2.5"
              }`}
            >
              <PlusIcon />
              {railSize === "fat" && "New"}
            </button>
            <div data-nav-kebab className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`flex w-full items-center text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300 ${
                  railSize === "fat" ? "gap-3 rounded-lg px-3 py-2 text-sm" : "justify-center rounded-lg p-2.5"
                }`}
              >
                <KebabIcon horizontal={true} />
                {railSize === "fat" && "More"}
              </button>
              {menuOpen &&
                renderMenu(
                  // Open the menu away from where the kebab sits so it stays on
                  // screen: cluster at the top → open downward; at the bottom →
                  // upward; centered → centered on the kebab.
                  `${navPosition === "left" ? "left-full ml-2" : "right-full mr-2"} ${
                    density === "compact" && anchor === "top"
                      ? "top-0"
                      : density === "compact" && anchor === "center"
                        ? "top-1/2 -translate-y-1/2"
                        : "bottom-0"
                  }`
                )}
            </div>
          </div>

          {density === "compact" && anchor === "center" && <div className="flex-1" />}
        </aside>
      )}

      {captureOpen && (
        <CaptureModal typeOptions={typeOptions} onClose={() => setCaptureOpen(false)} />
      )}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </nav>
  );
}

const menuItem =
  "block w-full rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800";
