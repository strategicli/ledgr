// The client nav chrome (v5 redesign). One bar of slots + a "+ New" quick
// capture + a kebab. The kebab moves the bar (Top / Bottom / Left / Right — a
// per-owner setting; left/right render as a side rail) and links to Build,
// Settings, and Trash. Search is a command-palette modal (Ctrl/Cmd+K); Build has
// a global shortcut (Ctrl/Cmd+Shift+B). Mobile always keeps the bottom bar; the
// position setting applies on desktop. The owner's navPosition arrives as a prop
// (Nav reads it server-side, so the layout can pad the body to match).
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CaptureModal from "@/components/capture/CaptureModal";
import SearchModal from "@/components/search/SearchModal";
import type { NavPosition } from "@/lib/settings";

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

const slotClass = (active: boolean) =>
  `relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] ${
    active ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
  }`;

function Badge({ count }: { count: number | null }) {
  if (count == null || count <= 0) return null;
  return (
    <span className="absolute right-1 top-0.5 rounded-full bg-[var(--accent)] px-1.5 py-px text-[10px] font-medium leading-tight text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Mobile is always the floating bottom bar; on desktop (sm+) the bar moves to the
// owner's chosen edge. left/right become a vertical side rail.
const POSITION_CLASS: Record<NavPosition, string> = {
  bottom:
    "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex-row",
  top:
    "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex-row sm:bottom-auto sm:top-3",
  left:
    "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex-row sm:bottom-auto sm:left-3 sm:top-1/2 sm:translate-x-0 sm:-translate-y-1/2 sm:flex-col",
  right:
    "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex-row sm:bottom-auto sm:right-3 sm:left-auto sm:top-1/2 sm:translate-x-0 sm:-translate-y-1/2 sm:flex-col",
};

const POSITIONS: { value: NavPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

export default function NavShell({
  slots,
  typeOptions,
  navPosition,
}: {
  slots: ShellSlot[];
  typeOptions: { key: string; label: string }[];
  navPosition: NavPosition;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const kebabRef = useRef<HTMLDivElement>(null);

  const inBuild = pathname.startsWith("/build") || pathname.startsWith("/views");

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

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) setMenuOpen(false);
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

  const menuItem = "block w-full rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800";

  return (
    <nav aria-label="Main">
      <div
        className={`fixed z-40 flex items-center gap-1 rounded-2xl border border-neutral-800 bg-neutral-900/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur ${POSITION_CLASS[navPosition]}`}
      >
        {/* Search moves to the end, next to New (v5). */}
        {[...slots.filter((s) => s.key !== "search"), ...slots.filter((s) => s.key === "search")].map((slot) =>
          slot.key === "search" ? (
            <button
              key={slot.key}
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              title="Search (⌘K)"
              className={slotClass(false)}
            >
              <Icon slot="search" />
              {slot.label}
            </button>
          ) : (
            <Link key={slot.key} href={slot.href} aria-label={slot.label} aria-current={isActive(slot.href) ? "page" : undefined} className={slotClass(isActive(slot.href))}>
              <Icon slot={slot.key} />
              {slot.label}
              <Badge count={slot.count} />
            </Link>
          )
        )}

        {/* + New (quick capture) */}
        <button
          onClick={() => setCaptureOpen(true)}
          title="Quick capture (q)"
          className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] text-[var(--accent)] hover:bg-neutral-800/60"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 8.5v7M8.5 12h7" />
          </svg>
          New
        </button>

        {/* Kebab: move the bar, Build, Settings, Trash */}
        <div ref={kebabRef} className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
            More
          </button>
          {menuOpen && (
            <div
              role="menu"
              className={`absolute z-50 w-44 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl shadow-black/50 ${
                navPosition === "left"
                  ? "left-0 bottom-full mb-2 sm:left-full sm:bottom-auto sm:top-0 sm:ml-2"
                  : navPosition === "right"
                    ? "right-0 bottom-full mb-2 sm:right-full sm:bottom-auto sm:top-0 sm:mr-2"
                    : navPosition === "top"
                      ? "right-0 top-full mt-2"
                      : "right-0 bottom-full mb-2"
              }`}
            >
              <Link href={inBuild ? "/" : "/build"} role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
                {inBuild ? "← Back to Work" : "Build"}
              </Link>
              <Link href="/settings" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
                Settings
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
            </div>
          )}
        </div>
      </div>

      {captureOpen && (
        <CaptureModal typeOptions={typeOptions} onClose={() => setCaptureOpen(false)} />
      )}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </nav>
  );
}
