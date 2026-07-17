// Live editing context tracker (ADR-162). Mounted once per open item canvas
// (only when settings.liveContextEnabled), this reports to the server what the
// owner is currently looking at: the item on mount, and their live text
// selection within the canvas as it changes. That single per-owner row is what
// Claude reads over MCP (get_active_context) to resolve "this note" / "this
// sentence" the way Notion's AI sidebar does.
//
// Deliberately lightweight: a debounced POST only when the selected text
// actually changes (never a keystroke heartbeat), and a keepalive DELETE on
// close so an abandoned tab doesn't leave a stale "current note" behind. The
// stored title is a convenience/fallback only — get_active_context re-reads the
// item fresh, so live title edits don't need reporting here.
"use client";

import { useEffect, useRef } from "react";

const SELECTION_DEBOUNCE_MS = 400;

async function report(
  itemId: string,
  title: string,
  selectionText: string | null
): Promise<void> {
  try {
    await fetch("/api/active-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, title, selectionText }),
    });
  } catch {
    // Best-effort: a failed context report just means Claude reads slightly
    // older context on its next call. Never surface it to the owner.
  }
}

export default function ActiveContextTracker({
  itemId,
  title,
}: {
  itemId: string;
  title: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  // The last selection text we sent, so an unchanged selection (or repeated
  // collapse) doesn't re-POST.
  const lastSent = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Announce the open item immediately (no selection yet).
    lastSent.current = null;
    void report(itemId, title, null);

    // The canvas region this tracker lives in; a selection outside it (nav,
    // chrome, a panel) is ignored so only note text counts as the sub-context.
    const scope =
      anchor.current?.closest<HTMLElement>("[data-toc-scope]") ?? null;

    function currentSelection(): string | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const text = sel.toString().trim();
      if (!text) return null;
      // Only count a selection whose anchor sits inside the canvas scope.
      if (scope) {
        const node = sel.anchorNode;
        if (!node || !scope.contains(node)) return null;
      }
      return text;
    }

    function flushSelection() {
      const text = currentSelection();
      if (text === lastSent.current) return;
      lastSent.current = text;
      void report(itemId, title, text);
    }

    function onSelectionChange() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flushSelection, SELECTION_DEBOUNCE_MS);
    }

    document.addEventListener("selectionchange", onSelectionChange);

    // Clear the context when the canvas closes (unmount) or the page goes away
    // (keepalive lets the DELETE outlive the page). A navigation to another
    // item remounts the tracker, which re-reports the new item.
    function clearOnHide() {
      try {
        void fetch("/api/active-context", { method: "DELETE", keepalive: true });
      } catch {
        /* best-effort */
      }
    }
    window.addEventListener("pagehide", clearOnHide);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("pagehide", clearOnHide);
      clearOnHide();
    };
  }, [itemId, title]);

  // An invisible anchor so we can locate the enclosing canvas scope in the DOM.
  return <span ref={anchor} hidden aria-hidden />;
}
