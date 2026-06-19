// Full-page item skeleton (UX pass): the canvas shell awaits getItem + getType
// + ancestors before any paint, so a tapped row showed nothing until the round
// trip resolved. This mirrors the canvas shape (title, field strip, body) at
// the same widths so the swap to real content doesn't jump.
export default function ItemLoading() {
  return (
    <div className="canvas-wide" aria-hidden>
      <div className="mx-auto w-full max-w-3xl px-12 pt-8">
        <div className="h-9 w-2/3 animate-pulse rounded bg-neutral-800" />
        <div className="mt-5 flex flex-wrap gap-3">
          <div className="h-5 w-20 animate-pulse rounded bg-neutral-900" />
          <div className="h-5 w-24 animate-pulse rounded bg-neutral-900" />
          <div className="h-5 w-16 animate-pulse rounded bg-neutral-900" />
        </div>
        <div className="mt-8 space-y-3">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-900" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-neutral-900" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-neutral-900" />
        </div>
      </div>
      <span className="sr-only">Loading item…</span>
    </div>
  );
}
