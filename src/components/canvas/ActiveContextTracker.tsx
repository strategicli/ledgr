// Live editing context tracker (ADR-162, extended by ADR-167a). Mounted once per
// surface that shows an open item (only when settings.liveContextEnabled), this
// reports to the server what the owner is currently looking at: the item, and
// their live text selection within it. That single per-owner row is what Claude
// reads over MCP (get_active_context) to resolve "this note" / "this sentence"
// the way Notion's AI sidebar does.
//
// Two hosts, one tracker:
//   - ItemCanvas mounts it per open canvas; the scope is found by walking up to
//     the enclosing [data-toc-scope].
//   - The Desk mounts ONE instance for the whole surface (DeskActiveContext),
//     pointed at the focused panel's active item, and passes `scopeSelector` so
//     the selection is read from whichever panel currently holds the pen. Only
//     one panel can be edited at a time, so one row is still the right model.
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
  scopeSelector,
}: {
  itemId: string;
  title: string;
  // Where to read selections from, as a CSS selector resolved fresh on every
  // selection change. The Desk passes the focused panel's scope so moving the
  // pen re-points it with no remount. Omitted (the canvas case) = walk up from
  // this component to its enclosing [data-toc-scope].
  scopeSelector?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  // The last selection text we sent, so an unchanged selection (or repeated
  // collapse) doesn't re-POST.
  const lastSent = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The item currently being reported, read by the unmount/pagehide clear so it
  // only clears its own context. A ref, not the prop, because the teardown
  // effect below runs once and must see the latest value.
  const reporting = useRef(itemId);

  // Report the open item and track selections. Re-runs when the item changes
  // (Desk focus moving to a panel on a different note); deliberately does NOT
  // clear on cleanup — a switch is a handoff, and clearing here would race the
  // incoming report. Teardown is the separate effect below.
  useEffect(() => {
    reporting.current = itemId;
    lastSent.current = null;
    void report(itemId, title, null);

    // The region a selection must sit inside for it to count as this item's
    // highlight; anything outside (nav, chrome, another Desk panel) is ignored.
    // Resolved per selection so the Desk's focused panel can change underneath.
    function resolveScope(): HTMLElement | null {
      if (scopeSelector) return document.querySelector<HTMLElement>(scopeSelector);
      return anchor.current?.closest<HTMLElement>("[data-toc-scope]") ?? null;
    }

    function currentSelection(): string | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const text = sel.toString().trim();
      if (!text) return null;
      const scope = resolveScope();
      // An explicit selector that resolves to nothing means "no eligible region
      // right now" (no focused panel), so nothing counts. Without a selector, a
      // missing scope falls back to accepting the selection, as before.
      if (scopeSelector && !scope) return null;
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
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [itemId, title, scopeSelector]);

  // Teardown only: the surface closed, or the page went away (keepalive lets the
  // DELETE outlive it). Scoped to the item we were reporting (?itemId=), so if
  // this clear loses a race with a newly-opened item's POST it matches nothing
  // instead of blanking the fresh context.
  useEffect(() => {
    function clearOnHide() {
      try {
        void fetch(
          `/api/active-context?itemId=${encodeURIComponent(reporting.current)}`,
          { method: "DELETE", keepalive: true }
        );
      } catch {
        /* best-effort */
      }
    }
    window.addEventListener("pagehide", clearOnHide);
    return () => {
      window.removeEventListener("pagehide", clearOnHide);
      clearOnHide();
    };
  }, []);

  // An invisible anchor so we can locate the enclosing canvas scope in the DOM.
  return <span ref={anchor} hidden aria-hidden />;
}
