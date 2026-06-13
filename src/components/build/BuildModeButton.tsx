// The Work/Build switch (PRD §4.10): a single floating button, separate from
// the main nav, that turns build mode on and off. "On" means you're on a Build
// surface, so the active state is derived from the path rather than a stored
// flag that could drift from where you actually are. The Build surfaces are
// /build* and /views* — Views is a building block reached from the Build home,
// so being on it should still read as Build (Brandon's feedback). Clicking from
// Work opens the Build home; clicking from anywhere in Build returns to Work.
// Sits on the right edge, ~1/3 up from the bottom (thumb-reachable on a phone),
// clear of the centered bottom bar.
"use client";

import { usePathname, useRouter } from "next/navigation";

// The routes that count as the Build surface for the toggle's state.
const BUILD_PREFIXES = ["/build", "/views"];

export default function BuildModeButton() {
  const pathname = usePathname();
  const router = useRouter();
  const inBuild = BUILD_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  return (
    <button
      onClick={() => router.push(inBuild ? "/" : "/build")}
      aria-pressed={inBuild}
      title={inBuild ? "Back to Work" : "Open the Build surface"}
      className={`fixed bottom-1/3 right-4 z-40 flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium shadow-lg shadow-black/30 backdrop-blur transition-colors ${
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
