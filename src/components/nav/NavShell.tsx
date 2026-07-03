// The client nav chrome (v6 redesign + ADR-056 configurable slots). A locked
// Home slot, then the owner's configurable middle slots, then a "+ New" quick
// capture and a "More" kebab. Rendered four ways by the owner's navPosition:
//
//   • bottom  — a floating pill, centered on the bottom edge (also the mobile
//               default on every position).
//   • top     — a full-width docked menu bar across the top.
//   • left /  — a full-height docked side rail with three sizes the collapse
//     right     arrow cycles: fat (icons + names) → thin (icons only) →
//               hidden (a reopen tab at the edge). The kebab uses horizontal
//               dots on the rail.
//
// Middle slots come from settings.navSlots (resolved server-side by Nav.tsx into
// ShellSlot[]). A slot is either a single `destination` or a `tools` group that
// opens a popover of child destinations. A destination pointing at /search opens
// the command palette instead of navigating (parity with the old Search slot).
// Build has a global shortcut (Ctrl/Cmd+Shift+B) and a glowing entry in More.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import BuildSidebar from "@/components/nav/BuildSidebar";
import FavoritesFlyout from "@/components/nav/FavoritesFlyout";
import {
  Chevron,
  Icon,
  IconWithCount,
  InlineBadge,
  KebabIcon,
  Logo,
  PlusIcon,
  WrenchIcon,
} from "@/components/nav/NavGlyphs";
import { useHoverPopover } from "@/components/nav/useHoverPopover";
import AppBadgeSync from "@/components/pwa/AppBadgeSync";
import CaptureModal from "@/components/capture/CaptureModal";
import CommandPalette from "@/components/search/CommandPalette";
import { isBuildPath } from "@/lib/build-nav";
import { NOTIFICATION_CENTER_ENABLED } from "@/lib/notifications-enabled";
import { BUILD_SIDEBAR_W, navPadVars, RAIL_W } from "@/lib/nav-layout";
import { FAVORITES_HREF, type NavDensity, type NavPosition, type RailAnchor, type RailSize } from "@/lib/settings";

// A single nav destination, resolved for render (icon key + any badge count).
export type ShellDest = {
  label: string;
  href: string;
  icon: string;
  count: number | null;
};

// A configured middle slot: one destination, or a named group of them.
export type ShellSlot =
  | ({ kind: "destination" } & ShellDest)
  | {
      kind: "tools";
      label: string;
      icon: string;
      count: number | null;
      children: ShellDest[];
    };

// Home is always the first slot and never configurable; prepended at render.
const HOME_SLOT: ShellSlot = {
  kind: "destination",
  label: "Home",
  href: "/",
  icon: "home",
  count: null,
};

// A destination at /search opens the command palette rather than navigating.
const isSearchHref = (href: string) => href === "/search";

// A destination at /favorites opens the favorites flyout rather than navigating.
const isFavoritesHref = (href: string) => href === FAVORITES_HREF;

// The mobile bar's scroll strip fades its content at any edge that still hides
// slots past it, hinting there's more to swipe to. A mask (not an overlay) so it
// works over the pill's translucent, blurred background without a color match.
const scrollFadeStyle = (edges: { left: boolean; right: boolean }): CSSProperties => {
  const l = edges.left ? 20 : 0;
  const r = edges.right ? 20 : 0;
  if (!l && !r) return {};
  const g = `linear-gradient(to right, transparent 0, #000 ${l}px, #000 calc(100% - ${r}px), transparent 100%)`;
  return { WebkitMaskImage: g, maskImage: g };
};

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
  mobileSlots,
  unreadCount,
  typeOptions,
  buildTypes,
  aiMemoryEnabled,
  navPosition,
  railSize: railSizeProp,
  navDensity: navDensityProp,
  railAnchor: railAnchorProp,
}: {
  slots: ShellSlot[];
  mobileSlots: ShellSlot[];
  // Unread notification count: seeds the PWA app-icon badge + the More-menu link.
  unreadCount: number;
  typeOptions: { key: string; label: string }[];
  // The owner's types, for the Build sidebar's Types & Properties dropdown.
  buildTypes: { key: string; label: string; icon: string | null }[];
  // AI Memory on? Gates the Build sidebar's "AI Memory" entry (ADR-137).
  aiMemoryEnabled: boolean;
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
  // Tools-group + Favorites popovers: hover-intent open (hover-capable
  // pointers) or click-toggle (touch), with outside-click dismiss.
  const {
    openId: openTools,
    setOpenId: setOpenTools,
    hoverOpen,
    hoverClose,
    toggle: toggleTools,
  } = useHoverPopover("[data-nav-tools]");
  // When a tools/favorites popover opens from the scrolling mobile bar, the slot
  // lives inside an `overflow-x-auto` strip that would clip an upward-opening
  // absolute popover. We anchor those popovers with `position: fixed` instead,
  // measured from the trigger on open (viewport coords), so they escape the
  // scroll box. Desktop layouts keep the plain absolute positioning.
  const [popRect, setPopRect] = useState<DOMRect | null>(null);

  // --- Mobile bar scroll behavior ------------------------------------------
  // The phone bottom bar scrolls its slot strip horizontally (floatingPill,
  // scrollable). This block powers the polish on that strip: edge-fade masks
  // that appear only when there's more to swipe to, auto-centering the active
  // slot when you land on its page, and a long-press to jump to the nav editor.
  const scrollStripRef = useRef<HTMLDivElement | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  // Which edges still hide content past them (drives the fade masks).
  const syncScrollEdges = useCallback(() => {
    const el = scrollStripRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setScrollEdges({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < maxScroll - 1,
    });
  }, []);

  // Center the active slot so "where am I" is always in view even when it's
  // scrolled off. rect-based math (offsetParent is unreliable in the fixed pill).
  // While `pendingCenter` is set (just navigated) this is retried on every layout
  // change until the strip actually overflows — on a fresh load it isn't laid out
  // yet when the navigation effect first fires, so a single measure no-ops.
  const pendingCenter = useRef(false);
  const centerActiveSlot = useCallback(() => {
    const el = scrollStripRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) {
      pendingCenter.current = false;
      return;
    }
    if (el.scrollWidth - el.clientWidth <= 0) return; // not overflowing yet; retry
    const sRect = el.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    const delta = aRect.left - sRect.left - (el.clientWidth - aRect.width) / 2;
    // Instant, not smooth: scroll-snap cancels a programmatic smooth scroll
    // mid-flight (it re-snaps to the origin), and instant placement is the right
    // feel for auto-positioning anyway — like a tab bar settling on the current tab.
    if (Math.abs(delta) > 1) el.scrollBy({ left: delta, behavior: "auto" });
    pendingCenter.current = false;
  }, []);

  // Keep the fade masks accurate as the strip scrolls, the viewport resizes, or
  // the configured slots change; a resize is also when a just-navigated center
  // finally lands (the strip has settled and now overflows).
  useEffect(() => {
    const el = scrollStripRef.current;
    if (!el) return;
    syncScrollEdges();
    el.addEventListener("scroll", syncScrollEdges, { passive: true });
    const ro = new ResizeObserver(() => {
      syncScrollEdges();
      if (pendingCenter.current) centerActiveSlot();
    });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", syncScrollEdges);
      ro.disconnect();
    };
  }, [syncScrollEdges, centerActiveSlot, mobileSlots]);

  // Re-center on navigation. The strip is display:none on desktop, so the query
  // finds nothing there and this is a mobile-only effect in practice. We poll a
  // few frames because a ResizeObserver won't help here — the strip's own box
  // stays a fixed width while its children overflow, so it never re-fires — and
  // on a fresh load the strip isn't overflowing yet when we first measure.
  useEffect(() => {
    pendingCenter.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    // setTimeout (not requestAnimationFrame): rAF is paused while the page is
    // hidden, so a background/prerendered tab would never center. Retry until the
    // strip has laid out and overflowed, then centerActiveSlot clears `pending`.
    const attempt = () => {
      centerActiveSlot();
      if (pendingCenter.current && tries++ < 25) timer = setTimeout(attempt, 40);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [pathname, mobileSlots, centerActiveSlot]);

  // Long-press the strip to jump to the nav editor. A ~500ms hold that doesn't
  // turn into a scroll fires it; the ensuing click is suppressed so it doesn't
  // also follow the pressed slot's link. A labeled equivalent ("Edit navigation")
  // lives in the More menu so the gesture is discoverable, not hidden.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressStripClick = useRef(false);
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const onStripTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    longPressStart.current = { x: t.clientX, y: t.clientY };
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      suppressStripClick.current = true;
      navigator.vibrate?.(8);
      router.push("/build/navigation");
    }, 500);
  };
  const onStripTouchMove = (e: ReactTouchEvent) => {
    const s = longPressStart.current;
    if (!s) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10) {
      cancelLongPress();
    }
  };
  const onStripClickCapture = (e: ReactMouseEvent) => {
    if (suppressStripClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressStripClick.current = false;
    }
  };

  const [railSize, setRailSize] = useState<RailSize>(railSizeProp);
  const [density, setDensity] = useState<NavDensity>(navDensityProp);
  const [anchor, setAnchor] = useState<RailAnchor>(railAnchorProp);

  const isRail = navPosition === "left" || navPosition === "right";
  // Build mode is `/build*` only. `/views` is now the Work-side consumer surface
  // (the builder/manager moved to /build/views — ADR-063 producer/consumer split),
  // so it no longer reads as Build.
  const inBuild = isBuildPath(pathname);

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

  // Keep the body's nav padding in lock-step with whatever chrome is showing.
  // In Build mode the Work nav is replaced by the fixed left sidebar, so the body
  // clears it on the left (desktop) regardless of the Work nav position. In Work
  // mode the four vars follow the position + live rail width, so a rail collapse
  // feels instant (the CSS transition on body smooths it) and crossing the
  // Work/Build line resets the padding cleanly. The vars apply at sm+ only;
  // mobile keeps its fixed bottom clearance (globals.css).
  useEffect(() => {
    const style = document.body.style;
    if (inBuild) {
      style.setProperty("--nav-pt", "0px");
      style.setProperty("--nav-pb", "0px");
      style.setProperty("--nav-pr", "0px");
      style.setProperty("--nav-pl", BUILD_SIDEBAR_W);
      return;
    }
    const vars = navPadVars(navPosition, railSize) as Record<string, string>;
    style.setProperty("--nav-pt", vars["--nav-pt"]);
    style.setProperty("--nav-pb", vars["--nav-pb"]);
    style.setProperty("--nav-pl", vars["--nav-pl"]);
    style.setProperty("--nav-pr", vars["--nav-pr"]);
  }, [inBuild, isRail, navPosition, railSize]);

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
  const slotActive = (slot: ShellSlot): boolean =>
    slot.kind === "tools"
      ? slot.children.some((c) => !isSearchHref(c.href) && isActive(c.href))
      : !isSearchHref(slot.href) && isActive(slot.href);

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

  // The locked Home slot leads every layout, then the configured middle slots.
  // Mobile and desktop bars get distinct id prefixes so a tools popover open on
  // one never bleeds into the other (both are in the DOM, one visible).
  const desktopSlots = [HOME_SLOT, ...slots].map((slot, i) => ({
    slot,
    id: i === 0 ? "home" : `d${i}`,
  }));
  const mobileBarSlots = [HOME_SLOT, ...mobileSlots].map((slot, i) => ({
    slot,
    id: i === 0 ? "home" : `m${i}`,
  }));

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
  // `w-full` so a tools/favorites button (wrapped in its own `relative` div for
  // the popover) stretches edge-to-edge like a bare destination Link does as a
  // direct flex child — otherwise its hover highlight only hugs the icon+label.
  const railFatSlot = (active: boolean) =>
    `relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${itemColors(active)}`;
  const railThinSlot = (active: boolean) =>
    `relative flex w-full items-center justify-center rounded-lg p-2.5 ${itemColors(active)}`;

  // A child row inside a tools popover (always icon + label + inline badge).
  function renderToolsChild(child: ShellDest, key: string) {
    const active = !isSearchHref(child.href) && isActive(child.href);
    const cls = `flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-sm ${itemColors(active)}`;
    const inner = (
      <>
        <Icon icon={child.icon} />
        <span className="truncate">{child.label}</span>
        <InlineBadge count={child.count} />
      </>
    );
    if (isSearchHref(child.href)) {
      return (
        <button
          key={key}
          role="menuitem"
          onClick={() => {
            setOpenTools(null);
            setSearchOpen(true);
          }}
          className={cls}
        >
          {inner}
        </button>
      );
    }
    return (
      <Link
        key={key}
        role="menuitem"
        href={child.href}
        onClick={() => setOpenTools(null)}
        aria-current={active ? "page" : undefined}
        className={cls}
      >
        {inner}
      </Link>
    );
  }

  // A popover opened from the scrolling mobile bar can't use absolute positioning
  // (the scroll strip clips it), so we anchor it `fixed` above the measured
  // trigger, centered and clamped to the viewport. `width` is the popover's px
  // width so the clamp keeps it fully on screen. These are viewport coordinates,
  // which is ONLY correct because the popover is portaled to <body> (mountFixed):
  // the mobile pill has both `-translate-x-1/2` (transform) and `backdrop-blur`
  // (backdrop-filter), and each makes a `fixed` descendant resolve against the
  // pill's box, not the viewport — so an in-tree fixed popover lands in the wrong
  // place. The portal escapes that containing block (and the scroll clip too).
  const fixedPopoverStyle = (width: number): CSSProperties => {
    if (!popRect) return {};
    const centerX = popRect.left + popRect.width / 2;
    const half = width / 2;
    const left = Math.min(
      Math.max(centerX, half + 8),
      window.innerWidth - half - 8
    );
    return {
      position: "fixed",
      left,
      bottom: window.innerHeight - popRect.top + 8,
      transform: "translateX(-50%)",
    };
  };

  // Portal a fixed popover to <body> so it escapes the pill's transform/blur
  // containing block and the scroll strip's overflow clip. Wrapped in
  // `data-nav-tools` so the outside-click closer still treats clicks inside it as
  // "inside" (the portal moves it out of the trigger's DOM subtree).
  const mountFixed = (node: ReactNode) =>
    typeof document === "undefined"
      ? null
      : createPortal(<div data-nav-tools>{node}</div>, document.body);

  // The popover a tools group opens; `posClass` anchors it relative to the slot.
  // On the scrolling mobile bar (`fixed`), it's anchored to the measured trigger
  // instead so it escapes the horizontal-scroll strip.
  function toolsPopover(
    slot: Extract<ShellSlot, { kind: "tools" }>,
    id: string,
    posClass: string,
    fixed = false
  ) {
    return (
      <div
        role="menu"
        style={fixed ? fixedPopoverStyle(208) : undefined}
        className={`${fixed ? "fixed" : "absolute"} z-50 max-h-[calc(100vh-1rem)] w-52 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl shadow-black/50 ${fixed ? "" : posClass}`}
      >
        <p className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
          {slot.label}
        </p>
        {slot.children.map((c, i) => renderToolsChild(c, `${id}-c${i}`))}
      </div>
    );
  }

  // One slot renderer for every layout: a destination (link, or the search
  // palette button), or a tools group button that toggles its popover.
  // `classNameFor` is the layout's class builder; `toolsPos` anchors the popover.
  // The count always rides the icon's corner (CountBubble), in every layout.
  function renderSlot(
    slot: ShellSlot,
    id: string,
    classNameFor: (active: boolean) => string,
    showLabel: boolean,
    toolsPos: string,
    // On the scrolling mobile bar, tools/favorites popovers anchor `fixed` to
    // the measured trigger so they escape the horizontal-scroll strip's clip.
    fixedPopover = false
  ) {
    const className = classNameFor(slotActive(slot));
    // Capture the trigger's viewport rect on open so a fixed popover can anchor
    // to it. Harmless on the desktop paths (fixedPopover is false there).
    const openPopover = (id: string, e: { currentTarget: HTMLElement }) => {
      if (fixedPopover) setPopRect(e.currentTarget.getBoundingClientRect());
      toggleTools(id);
    };
    const inner = (
      <>
        <IconWithCount icon={slot.icon} count={slot.count} />
        {showLabel && <span className="truncate">{slot.label}</span>}
      </>
    );

    if (slot.kind === "tools") {
      const open = openTools === id;
      return (
        <div
          key={id}
          data-nav-tools
          className="relative"
          onMouseEnter={() => hoverOpen(id)}
          onMouseLeave={hoverClose}
        >
          <button
            onClick={(e) => openPopover(id, e)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={slot.label}
            title={slot.label}
            className={className}
          >
            {inner}
          </button>
          {open &&
            (fixedPopover
              ? mountFixed(toolsPopover(slot, id, "", true))
              : toolsPopover(slot, id, toolsPos, false))}
        </div>
      );
    }

    // Favorites: a destination that opens the favorites flyout instead of
    // navigating. Reuses the tools open-state + outside-click closer.
    if (isFavoritesHref(slot.href)) {
      const open = openTools === id;
      return (
        <div
          key={id}
          data-nav-tools
          className="relative"
          onMouseEnter={() => hoverOpen(id)}
          onMouseLeave={hoverClose}
        >
          <button
            onClick={(e) => openPopover(id, e)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={slot.label}
            title={slot.label}
            className={className}
          >
            {inner}
          </button>
          {open &&
            (fixedPopover
              ? mountFixed(
                  <FavoritesFlyout
                    posClass=""
                    fixedStyle={fixedPopoverStyle(256)}
                    onNavigate={() => setOpenTools(null)}
                  />
                )
              : (
                <FavoritesFlyout
                  posClass={toolsPos}
                  onNavigate={() => setOpenTools(null)}
                />
              ))}
        </div>
      );
    }

    if (isSearchHref(slot.href)) {
      return (
        <button
          key={id}
          onClick={() => setSearchOpen(true)}
          aria-label={slot.label}
          title={`${slot.label} (⌘K)`}
          className={className}
        >
          {inner}
        </button>
      );
    }
    return (
      <Link
        key={id}
        href={slot.href}
        aria-label={slot.label}
        aria-current={isActive(slot.href) ? "page" : undefined}
        className={className}
      >
        {inner}
      </Link>
    );
  }

  // The shared More dropdown. `posClass` anchors it relative to the kebab; the
  // Build entry is the highlighted, glowing primary action.
  const renderMenu = (posClass: string) => (
    <div
      role="menu"
      className={`absolute z-50 max-h-[calc(100vh-1rem)] w-48 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl shadow-black/50 ${posClass}`}
    >
      {/* The Work-side door (destination-named "Build"). The More menu only
          renders in Work mode — in Build the whole Work chrome is replaced by the
          sidebar, whose "Back to Work" is the way out — so this is always Build. */}
      <Link
        href="/build"
        role="menuitem"
        onClick={() => setMenuOpen(false)}
        className="mb-1 flex items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/15 px-2.5 py-2 text-sm font-semibold text-[var(--accent)] shadow-[0_0_16px_-3px_var(--accent)] transition hover:bg-[var(--accent)]/25"
      >
        <WrenchIcon />
        Build
      </Link>
      {/* Notification center paused (ADR-130): hidden, recoverable via the flag. */}
      {NOTIFICATION_CENTER_ENABLED && (
        <Link
          href="/notifications"
          role="menuitem"
          onClick={() => setMenuOpen(false)}
          className={`${menuItem} flex items-center`}
        >
          Notifications
          <InlineBadge count={unreadCount} />
        </Link>
      )}
      <Link href="/settings" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
        User Settings
      </Link>
      <Link href="/build/navigation" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
        Edit navigation
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

      {/* Density (+ anchor). Hidden for the bottom bar, which is always compact.
          Both the rails and the top bar offer the same four-way choice — Spread
          plus three Compact anchors — so they mirror each other. The anchor is
          stored as top/center/bottom; on the top bar those read left/center/
          right (the same start/center/end idea, just on the horizontal axis). */}
      {navPosition !== "bottom" && (
        <>
          <p className="px-2 pt-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
            Spacing
          </p>
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
              {isRail ? "Compact (top)" : "Compact (left)"}
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
              {isRail ? "Compact (bottom)" : "Compact (right)"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  // The + New / More controls that trail every pill. On the scrolling mobile bar
  // these stay pinned outside the scroll strip — both open menus upward, which an
  // `overflow-x-auto` strip would clip.
  const pillTrailingControls = (
    <>
      {/* Search slot (ui-refresh S2): a permanent, visible entry to the ⌘K
          palette — the audit found search had zero affordance and was
          unreachable on a phone. Rides the trailing controls so it renders in
          whatever position the owner docked the nav. */}
      <button
        onClick={() => setSearchOpen(true)}
        title="Search (⌘K)"
        aria-label="Search"
        className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
      >
        <Icon icon="search" />
        Search
      </button>
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
    </>
  );

  // The floating pill (mobile on every position; desktop when navPosition is
  // bottom). `fill` widens the desktop bottom bar to the ~40rem canvas width and
  // spreads its items across, so it reads with the same presence as the others.
  // `scrollable` (the mobile bar) caps the pill at the viewport width and scrolls
  // the slot strip horizontally when the owner configures more slots than fit, so
  // the bar never runs off screen; + New / More stay pinned to the right. Tools
  // popovers open upward (the pill sits at the bottom edge); on the scrolling bar
  // they anchor `fixed` so the scroll strip can't clip them.
  const floatingPill = (
    barSlots: { slot: ShellSlot; id: string }[],
    extraClass: string,
    { fill = false, scrollable = false }: { fill?: boolean; scrollable?: boolean } = {}
  ) => (
    <div
      className={`fixed z-40 flex items-center rounded-2xl border border-neutral-800 bg-neutral-900/95 shadow-xl shadow-black/40 backdrop-blur ${
        fill
          ? "w-[40rem] max-w-[calc(100vw-2rem)] justify-between gap-1 p-2 [&_svg]:h-6 [&_svg]:w-6"
          : scrollable
            ? "max-w-[calc(100vw-1rem)] gap-1 p-1.5"
            : "gap-1 p-1.5"
      } ${extraClass}`}
    >
      {scrollable ? (
        <>
          <div
            ref={scrollStripRef}
            onTouchStart={onStripTouchStart}
            onTouchMove={onStripTouchMove}
            onTouchEnd={cancelLongPress}
            onTouchCancel={cancelLongPress}
            onClickCapture={onStripClickCapture}
            style={scrollFadeStyle(scrollEdges)}
            className="no-scrollbar nav-scroll-strip flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            {barSlots.map(({ slot, id }) =>
              renderSlot(slot, id, pillSlot, true, "", true)
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">{pillTrailingControls}</div>
        </>
      ) : (
        <>
          {barSlots.map(({ slot, id }) =>
            renderSlot(slot, id, pillSlot, true, "bottom-full mb-2 left-1/2 -translate-x-1/2")
          )}
          {pillTrailingControls}
        </>
      )}
    </div>
  );

  // In Build mode the Work nav is replaced by the fixed left sidebar (the clean
  // paradigm break). Everything else — the four Work layouts — renders only on
  // the Work side. The capture + command palette overlays are shared by both.
  return (
    <nav aria-label="Main">
      {/* PWA app-icon badge: only while the notification center is live (ADR-130). */}
      {NOTIFICATION_CENTER_ENABLED && <AppBadgeSync count={unreadCount} />}
      {inBuild && (
        <BuildSidebar
          types={buildTypes}
          aiMemoryEnabled={aiMemoryEnabled}
          onOpenSearch={() => setSearchOpen(true)}
        />
      )}

      {/* Mobile: always the floating bottom bar, whatever the desktop position.
          data-work-nav-pill lets the markdown editor hide it while editing
          (globals.css), so the floating formatting rail and this pill never
          fight for the same bottom-of-screen spot. */}
      {!inBuild && (
        <div className="sm:hidden" data-work-nav-pill>
          {floatingPill(mobileBarSlots, "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2", { scrollable: true })}
        </div>
      )}

      {/* Desktop chrome (sm+). One of four layouts. */}
      {!inBuild && navPosition === "bottom" && (
        <div className="hidden sm:block">
          {floatingPill(desktopSlots, "bottom-4 left-1/2 -translate-x-1/2", { fill: true })}
        </div>
      )}

      {!inBuild && navPosition === "top" && (
        // The bar always spans the full top edge (background + border line all
        // the way across), like the rails span the full height. Only the content
        // cluster moves, mirroring the rails: spread pins logo + items to the
        // left and pushes New/More to the right (ml-auto); compact groups the
        // whole cluster together and anchors it left / center / right via the
        // stored top / center / bottom anchor (start / center / end).
        <header className="fixed inset-x-0 top-0 z-40 hidden h-14 border-b border-neutral-800 bg-neutral-900/95 backdrop-blur sm:block">
          <div
            className={`flex h-full items-center gap-1 px-3 ${
              density === "compact"
                ? anchor === "center"
                  ? "justify-center"
                  : anchor === "bottom"
                    ? "justify-end"
                    : "justify-start"
                : ""
            }`}
          >
            <Logo className="-ml-1" />
            {desktopSlots.map(({ slot, id }) =>
              renderSlot(slot, id, topSlot, true, "top-full mt-2 left-0")
            )}
            <div className={`flex items-center gap-1 ${density === "spread" ? "ml-auto" : ""}`}>
              <button
                onClick={() => setSearchOpen(true)}
                title="Search (⌘K)"
                aria-label="Search"
                className="flex items-center rounded-lg p-2 text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
              >
                <Icon icon="search" />
              </button>
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
                {/* Open toward the screen, away from the kebab: when the cluster
                    hugs the left edge (compact-left) the menu aligns left so it
                    doesn't run off-screen; otherwise it aligns right. */}
                {menuOpen &&
                  renderMenu(
                    `top-full mt-2 ${
                      density === "compact" && anchor === "top" ? "left-0" : "right-0"
                    }`
                  )}
              </div>
            </div>
          </div>
        </header>
      )}

      {!inBuild && isRail && railSize === "hidden" && (
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

      {!inBuild && isRail && railSize !== "hidden" && (
        <aside
          className={`fixed inset-y-0 z-40 hidden flex-col gap-1 bg-neutral-900/95 p-2 shadow-xl shadow-black/30 backdrop-blur sm:flex ${
            navPosition === "left" ? "left-0 border-r border-neutral-800" : "right-0 border-l border-neutral-800"
          }`}
          style={{ width: RAIL_W[railSize] }}
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

          {/* Slots. The rail's tools popovers open to the docked side. */}
          <div className="flex flex-col gap-1">
            {desktopSlots.map(({ slot, id }) =>
              renderSlot(
                slot,
                id,
                railSize === "fat" ? railFatSlot : railThinSlot,
                railSize === "fat",
                `${navPosition === "left" ? "left-full ml-2" : "right-full mr-2"} top-0`
              )
            )}
          </div>

          {density === "spread" && <div className="flex-1" />}

          {/* Search + New + More. */}
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setSearchOpen(true)}
              title="Search (⌘K)"
              aria-label="Search"
              className={`flex items-center text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300 ${
                railSize === "fat" ? "gap-3 rounded-lg px-3 py-2 text-sm" : "justify-center rounded-lg p-2.5"
              }`}
            >
              <Icon icon="search" />
              {railSize === "fat" && "Search"}
            </button>
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
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
    </nav>
  );
}

const menuItem =
  "block w-full rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800";
