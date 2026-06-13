// The Work/Build switch (PRD §4.10): a single floating button, separate from
// the main nav, that turns build mode on and off. "On" means you're on the
// Build surface (a /build route), so the active state is derived from the path
// rather than a stored flag that could drift from where you actually are.
// Clicking it from Work opens the Build home; clicking it from anywhere in
// Build returns to Work. Sits top-right, clear of the bottom bar and the
// right-sidebar nav candidate.
"use client";

import { usePathname, useRouter } from "next/navigation";

export default function BuildModeButton() {
  const pathname = usePathname();
  const router = useRouter();
  const inBuild = pathname === "/build" || pathname.startsWith("/build/");

  return (
    <button
      onClick={() => router.push(inBuild ? "/" : "/build")}
      aria-pressed={inBuild}
      title={inBuild ? "Back to Work" : "Open the Build surface"}
      className={`fixed right-3 top-3 z-40 flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium shadow-lg shadow-black/30 backdrop-blur transition-colors sm:right-4 sm:top-4 ${
        inBuild
          ? "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
          : "border-neutral-800 bg-neutral-900/95 text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {/* A grid of blocks: the "building blocks" the Build surface assembles. */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      >
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </svg>
      {inBuild ? "Building" : "Build"}
    </button>
  );
}
