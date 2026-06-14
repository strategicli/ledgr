// The navigation chrome (PRD §4.12). Mobile is settled: a floating bottom
// bar. Desktop has two candidates behind the same slot model (open Q9): the
// same bottom bar, or a right sidebar; a toggle in the nav itself flips
// between them (preference in localStorage) so both get a real trial before
// one is kept.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import BuildModeButton from "@/components/build/BuildModeButton";
import CaptureModal from "@/components/capture/CaptureModal";

export type ShellSlot = {
  key: string;
  label: string;
  href: string;
  count: number | null;
};

type DesktopNav = "bar" | "sidebar";
const PREF_KEY = "ledgr.desktopNav";

// The preference lives in localStorage; useSyncExternalStore renders the
// server default ("bar") through hydration, then adopts the stored value.
const prefListeners = new Set<() => void>();
function subscribePref(listener: () => void) {
  prefListeners.add(listener);
  return () => {
    prefListeners.delete(listener);
  };
}
function readPref(): DesktopNav {
  return window.localStorage.getItem(PREF_KEY) === "sidebar"
    ? "sidebar"
    : "bar";
}
function writePref(value: DesktopNav) {
  window.localStorage.setItem(PREF_KEY, value);
  prefListeners.forEach((l) => l());
}

// Hand-rolled 20px stroke icons; an icon library for three glyphs would
// violate the boring-stack rule.
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

function SlotLink({
  slot,
  active,
  vertical,
}: {
  slot: ShellSlot;
  active: boolean;
  vertical: boolean;
}) {
  return (
    <Link
      href={slot.href}
      aria-label={slot.label}
      aria-current={active ? "page" : undefined}
      className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] ${
        active
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
      } ${vertical ? "w-14" : ""}`}
    >
      <Icon slot={slot.key} />
      {slot.label}
      {slot.count != null && slot.count > 0 && (
        <span className="absolute right-1 top-0.5 rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-medium leading-tight text-white">
          {slot.count > 99 ? "99+" : slot.count}
        </span>
      )}
    </Link>
  );
}

export default function NavShell({
  slots,
  typeOptions,
  entityKinds,
}: {
  slots: ShellSlot[];
  typeOptions: { key: string; label: string }[];
  entityKinds: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const desktopNav = useSyncExternalStore(subscribePref, readPref, () => "bar");
  const [captureOpen, setCaptureOpen] = useState(false);

  // Global shortcuts (PRD §4.4): q opens quick capture (Todoist muscle
  // memory), Ctrl/Cmd+K goes to search (the Notion default). q stays inert
  // while typing anywhere (inputs, selects, the BlockNote editor).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        router.push("/search");
        return;
      }
      if (e.key === "q" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        if (
          t instanceof HTMLElement &&
          (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
        ) {
          return;
        }
        e.preventDefault();
        setCaptureOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  function toggleDesktopNav() {
    writePref(desktopNav === "bar" ? "sidebar" : "bar");
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const toggle = (
    <button
      onClick={toggleDesktopNav}
      title={
        desktopNav === "bar" ? "Try the right sidebar" : "Back to the bottom bar"
      }
      className="hidden flex-col items-center rounded-xl px-2 py-1.5 text-neutral-600 hover:bg-neutral-800/60 hover:text-neutral-300 sm:flex"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        {desktopNav === "bar" ? (
          // panel-right: where the sidebar would go
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
          </>
        ) : (
          // panel-bottom: where the bar would go
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 15h18" />
          </>
        )}
      </svg>
    </button>
  );

  const newButton = (vertical: boolean) => (
    <button
      onClick={() => setCaptureOpen(true)}
      title="Quick capture (q)"
      className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] text-blue-400 hover:bg-neutral-800/60 hover:text-blue-300 ${
        vertical ? "w-14" : ""
      }`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
      New
    </button>
  );

  const links = (vertical: boolean) =>
    slots.map((slot) => (
      <SlotLink
        key={slot.key}
        slot={slot}
        active={isActive(slot.href)}
        vertical={vertical}
      />
    ));

  return (
    <>
      {/* The Work/Build switch (PRD §4.10): floating, separate from the nav. */}
      <BuildModeButton />
      <nav aria-label="Main">
      {/* Mobile: always the floating bottom bar (settled, PRD §4.12). On
          desktop this same element serves bar mode. */}
      <div
        className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-neutral-800 bg-neutral-900/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur ${
          desktopNav === "sidebar" ? "sm:hidden" : ""
        }`}
      >
        {links(false)}
        {newButton(false)}
        {desktopNav === "bar" && toggle}
      </div>
      {/* Desktop sidebar candidate (open Q9): same slots, vertical, right
          edge. Hidden below sm; mobile keeps the bar. */}
      {desktopNav === "sidebar" && (
        <div className="fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-neutral-800 bg-neutral-900/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur sm:flex">
          {links(true)}
          {newButton(true)}
          {toggle}
        </div>
      )}
      {captureOpen && (
        <CaptureModal
          typeOptions={typeOptions}
          entityKinds={entityKinds}
          onClose={() => setCaptureOpen(false)}
        />
      )}
      </nav>
    </>
  );
}
