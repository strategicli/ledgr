// Center-modal chrome for the intercepted item route (PRD §4.13). Close =
// Esc, backdrop click, or the ✕ button, all router.back() so the list
// underneath is exactly where the user left it. Expand is a plain anchor
// (hard navigation) so the same URL re-renders as the full page form.
"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";
import SaveAsTemplateButton from "@/components/canvas/SaveAsTemplateButton";

export default function Modal({
  itemId,
  children,
  wide = false,
  title = "",
  isTemplate = false,
}: {
  itemId: string;
  children: React.ReactNode;
  // Wider panel for canvases that need the room (a song's two-column chart);
  // the default keeps note/task previews compact.
  wide?: boolean;
  // For the header's "Save as template" default name; and to swap chrome on a
  // template prototype (its delete is the registry-aware banner action, not the
  // generic item Trash, which would orphan the registry row) — ADR-093 TPL2.
  title?: string;
  isTemplate?: boolean;
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 py-3 sm:px-6 sm:py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-neutral-800 bg-[var(--background)] shadow-2xl ${
          wide ? "max-w-5xl" : "max-w-3xl"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-1 px-3 pt-2">
          <div className="flex items-center gap-1">
            {/* A template prototype's destructive/templatize actions live in its
                canvas banner (registry-aware); the generic item chrome is hidden. */}
            {!isTemplate && (
              <>
                <ConfirmButton
                  title="Move to Trash?"
                  description="This item moves to Trash and can be recovered for 30 days."
                  confirmLabel="Trash"
                  trigger="Trash"
                  triggerLabel="Move to Trash"
                  triggerClassName="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                  align="left"
                  onConfirm={async () => {
                    const res = await fetch(`/api/items/${itemId}`, { method: "DELETE" });
                    if (!res.ok) throw new Error(`Failed (${res.status})`);
                    close();
                  }}
                />
                <SaveAsTemplateButton
                  itemId={itemId}
                  defaultName={title || "Untitled"}
                  align="left"
                  triggerClassName="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
                />
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
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
              aria-label="Close"
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto pb-12">{children}</div>
      </div>
    </div>
  );
}
