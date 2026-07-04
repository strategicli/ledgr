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
import Launcher, { type LauncherTile } from "@/components/nav/Launcher";
import { isBuildPath } from "@/lib/build-nav";
import { NOTIFICATION_CENTER_ENABLED } from "@/lib/notifications-enabled";
import { BUILD_SIDEBAR_W, navPadVars, RAIL_W } from "@/lib/nav-layout";
import {
  FAVORITES_HREF,
  RECOMMENDED_MOBILE_NAV_SLOTS,
  type NavDensity,
  type NavPosition,
  type RailAnchor,
  type RailSize,
} from "@/lib/settings";

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
  const [launcherOpen, setLauncherOpen] = useState(false);
  // Tools-group + Favorites popovers: hover-intent open (hover-capable
  // pointers) or click-toggle (touch), with outside-click dismiss.
  const {
    openId: openTools,
    setOpenId: setOpenTools,
    hoverOpen,
    hoverClose,
    toggle: toggleTools,
  } = useHoverPopover("[data-nav-tools]");
  // --- Mobile bar swipe-up → launcher --------------------------------------
  // The phone bottom bar is a FIXED icon-only bar (ui-refresh Q7): it never
  // scrolls, showing the owner's daily few destinations; everything else lives in
  // the pull-up Launcher. Beyond tapping the grip, a deliberate swipe-up anywhere
  // on the bar opens the Launcher (S6a). The claim mirrors SwipeRow's discipline
  // (mostly-vertical, upward, past a threshold) so a tap on a slot still fires
  // and a horizontal drift never triggers it; the ensuing click is swallowed so a
  // swipe that started on a slot doesn't also follow its link.
  const barSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const barSwipeClaimed = useRef(false);
  const onBarTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    barSwipeStart.current = { x: t.clientX, y: t.clientY };
    barSwipeClaimed.current = false;
  };
  const onBarTouchMove = (e: ReactTouchEvent) => {
    const s = barSwipeStart.current;
    if (!s || barSwipeClaimed.current) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Upward, mostly-vertical, past the threshold → open the launcher.
    if (dy < -28 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      barSwipeClaimed.current = true;
      navigator.vibrate?.(8);
      setLauncherOpen(true);
    }
  };
  const onBarTouchEnd = () => {
    barSwipeStart.current = null;
  };
  const onBarClickCapture = (e: ReactMouseEvent) => {
    if (barSwipeClaimed.current) {
      e.preventDefault();
      e.stopPropagation();
      barSwipeClaimed.current = false;
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

  // The pull-up launcher (S6) holds EVERY destination — the owner's full nav set
  // (a tools group expands to its children) plus the built-in extras — so the
  // fixed mobile bar can carry only the daily few and nothing is out of reach.
  const launcherTiles: LauncherTile[] = [
    ...[HOME_SLOT, ...slots].flatMap((s) =>
      s.kind === "tools"
        ? s.children.map((c) => ({ label: c.label, href: c.href, icon: c.icon, count: c.count }))
        : [{ label: s.label, href: s.href, icon: s.icon, count: s.count }]
    ),
    { label: "Search", href: "/search", icon: "search" },
    { label: "Build", href: "/build", icon: "tools" },
    { label: "Edit nav", href: "/build/navigation", icon: "navigation" },
    { label: "Settings", href: "/settings", icon: "bolt" },
    { label: "Changelog", href: "/changelog", icon: "book" },
    { label: "Trash", href: "/trash", icon: "archive" },
  ];

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
  // Compact, non-shrinking variant for the mobile FIXED bar (Q7): tighter padding
  // (px-2) so ~5 icon-only slots + grip + Search + New fit without scrolling, and
  // `shrink-0` so a tap target never squeezes when the row is full. The active
  // slot's label is width-capped so a long name can't blow out the row.
  const pillSlotMobile = (active: boolean) =>
    `relative flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] [&_span]:max-w-[3.75rem] [&_span]:truncate ${
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

  // A popover opened from the mobile fixed bar is centered above the bar, pinned
  // to the viewport. It must be portaled to <body>: the pill has `backdrop-blur`
  // (and a centering transform), and each makes a `position: fixed` descendant
  // resolve against the pill's box, not the viewport — so an in-tree fixed
  // popover lands wrong. The portal escapes that. This replaces the old
  // per-trigger rect-measurement (popRect + fixedPopoverStyle): a static
  // viewport-centered anchor is enough now the scroll strip is gone (Q7), and it
  // can't overflow a screen edge the way a slot-centered `absolute` popover would.
  const MOBILE_POPOVER_STYLE: CSSProperties = {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "calc(4.75rem + env(safe-area-inset-bottom))",
  };
  // Wrapped in `data-nav-tools` so the outside-click closer still counts clicks
  // inside it as "inside" (the portal moves it out of the trigger's subtree).
  const mountMobilePopover = (node: ReactNode) =>
    typeof document === "undefined"
      ? null
      : createPortal(<div data-nav-tools>{node}</div>, document.body);

  // The popover a tools group opens. Desktop layouts anchor it `absolute` to the
  // slot's `relative` wrapper via `posClass`; the mobile bar (`mobileBar`) anchors
  // it `fixed`, centered above the bar (portaled by the caller).
  function toolsPopover(
    slot: Extract<ShellSlot, { kind: "tools" }>,
    id: string,
    posClass: string,
    mobileBar = false
  ) {
    return (
      <div
        role="menu"
        style={mobileBar ? MOBILE_POPOVER_STYLE : undefined}
        className={`${mobileBar ? "fixed max-w-[calc(100vw-1rem)]" : "absolute"} z-50 max-h-[calc(100vh-1rem)] w-52 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl shadow-black/50 ${mobileBar ? "" : posClass}`}
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
    // On the mobile fixed bar, tools/favorites popovers portal to <body> and
    // center above the bar so they escape the pill's blur/transform and can't
    // overflow a screen edge.
    mobileBar = false
  ) {
    const className = classNameFor(slotActive(slot));
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
            onClick={() => toggleTools(id)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={slot.label}
            title={slot.label}
            className={className}
          >
            {inner}
          </button>
          {open &&
            (mobileBar
              ? mountMobilePopover(toolsPopover(slot, id, "", true))
              : toolsPopover(slot, id, toolsPos))}
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
            onClick={() => toggleTools(id)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={slot.label}
            title={slot.label}
            className={className}
          >
            {inner}
          </button>
          {open &&
            (mobileBar
              ? mountMobilePopover(
                  <FavoritesFlyout
                    posClass=""
                    fixedStyle={MOBILE_POPOVER_STYLE}
                    onNavigate={() => setOpenTools(null)}
                  />
                )
              : (
                <FavoritesFlyout posClass={toolsPos} onNavigate={() => setOpenTools(null)} />
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

  // The Search / + New / More controls that trail the DESKTOP bottom pill (the
  // full-label variant). The mobile fixed bar uses its own tighter trailing set
  // below (Search + New, icon-only; More retired into the Launcher — Q7).
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

  // The mobile fixed bar's trailing controls (Q7): Search + New, icon-only to
  // save width. More is gone from the mobile bar — its contents live in the
  // Launcher (Build/Settings/Trash/Edit-nav/Changelog tiles) and User Settings.
  const mobileTrailingControls = (
    <>
      <button
        onClick={() => setSearchOpen(true)}
        title="Search (⌘K)"
        aria-label="Search"
        className="flex shrink-0 items-center rounded-xl p-2 text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
      >
        <Icon icon="search" />
      </button>
      <button
        onClick={() => setCaptureOpen(true)}
        title="Quick capture (q)"
        aria-label="Quick capture"
        className="flex shrink-0 items-center rounded-xl p-2 text-[var(--accent)] hover:bg-neutral-800/60"
      >
        <PlusIcon />
      </button>
    </>
  );

  // The floating pill. `fill` = the desktop bottom bar (widened to the ~40rem
  // canvas width, full labels). `mobile` = the phone bottom bar (Q7): a FIXED,
  // icon-only, non-scrolling bar — a grip to the Launcher, the owner's daily few
  // slots (label only under the active one), then Search + New. It never scrolls
  // (the long tail lives in the Launcher, one tap on the grip or a swipe-up away),
  // so a destination's position is stable and muscle memory forms. A mobile-bar
  // tools/favorites popover portals above the bar (mobileBar in renderSlot).
  const floatingPill = (
    barSlots: { slot: ShellSlot; id: string }[],
    extraClass: string,
    { fill = false, mobile = false }: { fill?: boolean; mobile?: boolean } = {}
  ) => (
    <div
      className={`fixed z-40 flex rounded-2xl border border-neutral-800 bg-neutral-900/95 shadow-xl shadow-black/40 backdrop-blur ${
        fill
          ? "items-center w-[40rem] max-w-[calc(100vw-2rem)] justify-between gap-1 p-2 [&_svg]:h-6 [&_svg]:w-6"
          : mobile
            ? "touch-none flex-col max-w-[calc(100vw-1rem)] gap-0.5 px-1.5 pb-1.5 pt-0.5"
            : "items-center gap-1 p-1.5"
      } ${extraClass}`}
      {...(mobile
        ? {
            onTouchStart: onBarTouchStart,
            onTouchMove: onBarTouchMove,
            onTouchEnd: onBarTouchEnd,
            onTouchCancel: onBarTouchEnd,
            onClickCapture: onBarClickCapture,
          }
        : {})}
    >
      {mobile ? (
        <>
          {/* Grab handle: the visible affordance for the pull-up gesture. Tap it
              (or swipe up anywhere on the bar) to open the Launcher of every
              destination (S6a). Sits at the top edge like a sheet grabber so the
              bar reads as draggable. */}
          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            aria-label="All destinations (pull up)"
            title="All destinations (pull up)"
            className="flex justify-center py-1"
          >
            <span className="h-1 w-8 rounded-full bg-neutral-600" aria-hidden />
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLauncherOpen(true)}
              aria-label="All destinations"
              title="All destinations (pull up)"
              className="flex shrink-0 items-center rounded-xl p-2 text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
            >
              <Icon icon="grid" />
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
              {barSlots.map(({ slot, id }) =>
                // Label only under the active slot; the rest are icon-only (Q7). The
                // last arg = mobileBar: tools/favorites popovers portal above the bar.
                renderSlot(slot, id, pillSlotMobile, slotActive(slot), "", true)
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">{mobileTrailingControls}</div>
          </div>
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
          {/* Fixed icon-only bar: Home + the owner's first few mobile slots
              (RECOMMENDED_MOBILE_NAV_SLOTS cap); the rest live in the Launcher. */}
          {floatingPill(
            mobileBarSlots.slice(0, RECOMMENDED_MOBILE_NAV_SLOTS),
            "bottom-[calc(0.25rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2",
            { mobile: true }
          )}
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
      {/* Pull-up launcher (S6): every destination, one tap up. Mobile-only. */}
      <Launcher
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        tiles={launcherTiles}
        onSearch={() => setSearchOpen(true)}
      />
    </nav>
  );
}

const menuItem =
  "block w-full rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800";
