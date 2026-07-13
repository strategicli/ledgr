// Pure, stateless nav-chrome icon/glyph components — split out of NavShell.tsx
// so the orchestrator isn't also the icon library. Hand-rolled 20px strokes,
// no icon-library dependency (Principle 5).
"use client";

import Link from "next/link";
import NavGlyph from "@/components/nav/NavGlyph";
import { badgeCount } from "@/lib/format-count";

// Delegate to NavGlyph so both the stroke-glyph keys AND the licensed "ai:"
// filled set render (NavGlyph is the single resolution point). Rendering the
// paths inline here missed "ai:" refs, so a slot with an AI-set icon fell back
// to the generic glyph in the real nav while the Build picker showed it right.
export function Icon({ icon }: { icon: string }) {
  return <NavGlyph icon={icon} size={20} />;
}

export function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

export function WrenchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.2l-5.1 5.1a1.5 1.5 0 0 0 2.1 2.1l5.1-5.1a3.5 3.5 0 0 0 4.2-4.6l-2 2-1.7-1.7 2-2Z" />
    </svg>
  );
}

// The Ledgr wordmark; --font-logo is set on <html> by the layout. The full
// mark ends its "r" in the accent color; the compact mark (thin rail, where the
// wordmark won't fit) is a single accented "L".
export function Logo({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
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
export function KebabIcon({ horizontal }: { horizontal: boolean }) {
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

export function Chevron({ dir, size = 16 }: { dir: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <path d="m14 6-6 6 6 6" /> : <path d="m10 6 6 6-6 6" />}
    </svg>
  );
}

// The count bubble sits directly on top of the icon, overlapping its upper-right
// (Brandon's preference — the number reads as "in the box," not floating above
// it), so the icon must be wrapped in a relative element. Used for every slot in
// every layout.
function CountBubble({ count }: { count: number | null }) {
  if (count == null || count <= 0) return null;
  return (
    <span
      className="absolute right-0 top-0 rounded-full px-1 py-px text-[9px] font-medium leading-none text-white"
      style={{ background: "var(--accent-gradient, var(--accent))" }}
    >
      {badgeCount(count)}
    </span>
  );
}

// The icon with its count bubble overlaid on the corner.
export function IconWithCount({ icon, count }: { icon: string; count: number | null }) {
  return (
    <span className="relative inline-flex">
      <Icon icon={icon} />
      <CountBubble count={count} />
    </span>
  );
}

export function InlineBadge({ count }: { count: number | null }) {
  if (count == null || count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 py-px text-[10px] font-medium leading-tight text-white">
      {badgeCount(count)}
    </span>
  );
}
