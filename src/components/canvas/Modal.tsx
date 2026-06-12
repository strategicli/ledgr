// Center-modal chrome for the intercepted item route (PRD §4.13). Close =
// Esc, backdrop click, or the ✕ button, all router.back() so the list
// underneath is exactly where the user left it. Expand is a plain anchor
// (hard navigation) so the same URL re-renders as the full page form.
"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Modal({
  itemId,
  children,
}: {
  itemId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // BlockNote popovers (slash menu, mention picker) consume their own
      // Escape and prevent default; only an unclaimed Esc closes the modal.
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // one scroll context: the panel
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  // Title/field edits made in the modal must show in the list underneath
  // the moment it closes; refresh-on-unmount runs after back() lands.
  useEffect(() => {
    return () => router.refresh();
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 py-6 sm:px-6 sm:py-12"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-[var(--background)] shadow-2xl">
        <div className="flex shrink-0 items-center justify-end gap-1 px-3 pt-2">
          {/* Plain <a>, not <Link>: a soft nav to the same URL would stay
              intercepted; a document load renders the full page form. */}
          <a
            href={`/items/${itemId}`}
            className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            title="Expand to full page"
          >
            ⤢ Expand
          </a>
          <button
            onClick={close}
            className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto pb-2">{children}</div>
      </div>
    </div>
  );
}
