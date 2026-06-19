// Root navigation fallback (UX pass): every Work page is force-dynamic and
// awaits the DB before first paint, which showed a blank screen on each nav.
// This calm skeleton fills the common page column (max-w-3xl) while the server
// renders. The layout's Nav persists around it, so only the content swaps.
export default function Loading() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12" aria-hidden>
        <div className="h-7 w-40 animate-pulse rounded bg-neutral-800" />
        <div className="mt-2 h-4 w-24 animate-pulse rounded bg-neutral-900" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-neutral-900" />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </main>
  );
}
