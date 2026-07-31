// Presentation Export (Brandon, 2026-07-31): one press, two documents, for
// handing a manuscript to whoever is running slides.
//
//   1. the stripped manuscript — /items/[id]/print?booth=1 — colors flattened,
//      cut material and private notes gone, a **[SLIDE N]** cue at every
//      highlight. Opens in a new tab; its @media print rules make the browser's
//      print-to-PDF the PDF leg, exactly like Save Offline (no PDF dependency).
//   2. the slides document — POST /api/items/[id]/slides — a child note holding
//      every highlighted passage and quote, numbered to match those cues.
//
// The tab is opened SYNCHRONOUSLY on the click, before the await: a window.open
// that happens after an async hop is what popup blockers kill. The two legs are
// independent anyway — the print view renders from the stored body and needs
// nothing from the POST.
"use client";

import { useState } from "react";

type State =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; slides: number; slidesItemId: string | null }
  | { phase: "fail"; detail: string };

export default function PresentationExport({
  itemId,
  bare = false,
}: {
  itemId: string;
  // Matches SaveOffline/ShareLink: drop the standalone canvas wrapper when nested
  // in a section that already handles alignment (the shared footer does).
  bare?: boolean;
}) {
  const [state, setState] = useState<State>({ phase: "idle" });

  async function run() {
    if (state.phase === "busy") return;
    window.open(`/items/${itemId}/print?booth=1`, "_blank");
    setState({ phase: "busy" });
    try {
      const res = await fetch(`/api/items/${itemId}/slides`, { method: "POST" });
      if (!res.ok) {
        setState({ phase: "fail", detail: `slides document failed (${res.status})` });
        return;
      }
      const result = (await res.json()) as {
        slides: number;
        slidesItemId: string | null;
      };
      setState({ phase: "done", ...result });
    } catch {
      setState({ phase: "fail", detail: "slides document unreachable (offline?)" });
    }
  }

  return (
    <div className={bare ? "" : "mx-auto w-full max-w-3xl px-2 pt-2 sm:px-8 md:px-12"}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void run()}
          disabled={state.phase === "busy"}
          className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
        >
          {state.phase === "busy" ? "Working…" : "Presentation Export"}
        </button>
        {/* The control explains itself rather than relying on a walkthrough
            (CLAUDE.md: scope the UI when you build something big). */}
        <span className="group relative text-xs text-ink-subtle">
          <span className="cursor-help underline decoration-dotted decoration-neutral-600 underline-offset-2">
            what this does
          </span>
          <span
            role="tooltip"
            className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 w-72 rounded border border-neutral-700 bg-neutral-900 p-2 text-xs normal-case text-neutral-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
          >
            Opens a clean black-and-white copy of this document for print or PDF:
            no colors, no struck-through text, no notes to self, and a{" "}
            <strong>[SLIDE N]</strong> cue at every <strong>blue highlight</strong>
            . Also writes those passages into a “Slides” note attached to this item,
            in the same order. <strong>Highlight in blue</strong> to put a passage or
            quote on the screen; every other highlight color is just for you.
          </span>
        </span>
      </div>
      {state.phase === "fail" && (
        <p className="mt-1.5 text-xs text-red-400">{state.detail}</p>
      )}
      {state.phase === "done" && (
        <p className="mt-1.5 text-xs text-ink-subtle">
          {state.slides === 0 ? (
            <span className="text-amber-500/90">
              Clean copy opened. Nothing is highlighted, so there are no slides yet.
            </span>
          ) : (
            <>
              <span className="text-green-500/90">
                Clean copy opened · {state.slides} slide
                {state.slides === 1 ? "" : "s"} ✓
              </span>
              {state.slidesItemId && (
                <a
                  href={`/items/${state.slidesItemId}`}
                  target="_blank"
                  className="ml-2 text-neutral-500 hover:text-neutral-300"
                >
                  open slides ↗
                </a>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}
