// Shared skeleton primitives for route-level loading.tsx fallbacks. These paint
// the *shape* of the destination the instant a navigation starts, so the screen
// changes immediately instead of holding the old page until the server responds.
// Pure presentational, no client JS. Pairs with the global NavProgress bar.

// A single shimmering block. Tailwind's animate-pulse, no dependency.
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-neutral-900 ${className}`} aria-hidden />;
}

// A page heading placeholder (title + subtitle), matching the real pages' lede.
export function SkeletonHeading() {
  return (
    <div aria-hidden>
      <div className="h-7 w-40 animate-pulse rounded bg-neutral-800" />
      <div className="mt-2 h-4 w-24 animate-pulse rounded bg-neutral-900" />
    </div>
  );
}

// A stack of list rows.
export function SkeletonRows({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-neutral-900" />
      ))}
    </div>
  );
}

// A horizontal strip of tab/lens pills (Tasks, list lenses, etc.).
export function SkeletonTabs({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-2" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-7 w-20 animate-pulse rounded-full bg-neutral-900" />
      ))}
    </div>
  );
}

// A responsive grid of card placeholders (dashboards, board columns, view cards).
export function SkeletonCards({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${className}`} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-lg bg-neutral-900" />
      ))}
    </div>
  );
}

// The standard reading-column wrapper the Work pages render into.
export function SkeletonPage({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="min-h-screen">
      <div className={`mx-auto w-full px-6 py-10 sm:px-12 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        {children}
      </div>
      <span className="sr-only">Loading…</span>
    </main>
  );
}
