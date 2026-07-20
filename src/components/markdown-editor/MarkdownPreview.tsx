// Preview mode (ADR-125): a body's markdown rendered to read-only HTML, the
// default landing for large "document" notes (ebooks, PDF dumps) where reading,
// not editing, is the common act. The render runs on the SERVER (markdown-it is
// server-only by rule, markdown-render.ts) via /api/render-markdown, so this
// client component only fetches the resulting HTML for whatever text it's given
// — the live text at the moment Preview is opened, so unsaved Source edits show
// when you flip back. Styled with .ledgr-prose so it reads like the in-app
// editor. dangerouslySetInnerHTML is safe under Ledgr's single-owner model: the
// owner's own content, rendered by the owner, the same trust basis as the
// print/share document (see markdown-render.ts).
//
// State is keyed by the text it was computed for (`rendered.for` / `failed`), so
// the loading vs ready vs error state is DERIVED in render and setState is only
// ever called from the async callbacks — never synchronously in the effect.
//
// Quiet updates (ADR-146, the Desk): when the text changes (a read-only twin
// following the writer's keystrokes, or the mode toggle), we DON'T blank back to
// "Rendering…" — the previously-rendered HTML stays on screen until the new HTML
// arrives, then swaps in place. Combined with a module-level HTML cache keyed by
// content, a remount for text we've already rendered paints instantly. Together
// these kill the white "flash" the old drop-to-placeholder caused.
"use client";

import { useEffect, useState } from "react";
import { deskSendAvailable, openDeskSendMenu } from "@/lib/desk/send";

// Rendered-HTML cache shared across every MarkdownPreview instance, keyed by the
// (itemId, text) the server rendered for — so opening the same body in a second
// panel, or the writer↔preview swap, reuses the HTML instead of flashing through
// a fetch. Bounded FIFO so a long session can't grow it without limit.
const HTML_CACHE = new Map<string, string>();
const HTML_CACHE_MAX = 60;
function cacheKey(itemId: string | undefined, text: string): string {
  // \n separates the id from the body; an id (a UUID, or "") never contains a
  // newline, so the joined key is unambiguous.
  return `${itemId ?? ""}\n${text}`;
}
function cachePut(key: string, html: string): void {
  if (HTML_CACHE.has(key)) HTML_CACHE.delete(key);
  HTML_CACHE.set(key, html);
  if (HTML_CACHE.size > HTML_CACHE_MAX) {
    const oldest = HTML_CACHE.keys().next().value;
    if (oldest !== undefined) HTML_CACHE.delete(oldest);
  }
}

// Right-click an item link in the rendered body → the Send-to-Desk menu (S3b),
// with the host item as "current" so "Open beside" puts it left, the link right.
// Desktop-only; on touch/small screens the native context menu is left alone.
function itemIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = /\/items\/([0-9a-f-]{36})(?:[#?].*)?$/i.exec(href);
  return m ? m[1] : null;
}

export default function MarkdownPreview({
  text,
  itemId,
}: {
  text: string;
  // The open item's id, so Preview resolves its live {{item.*}} tokens (LT1).
  // Omitted (e.g. a template prototype preview) → tokens render raw.
  itemId?: string;
}) {
  // Last HTML this component fetched (for text NOT already in the shared cache).
  // setState only ever fires from the async fetch callbacks below — never
  // synchronously in the effect — per the module rule.
  const [rendered, setRendered] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!text.trim()) return; // empty body is handled in render, no fetch
    // Already cached (a twin, or an earlier render of this text) — render reads
    // the cache directly below, so there's nothing to fetch or set here.
    if (HTML_CACHE.has(cacheKey(itemId, text))) return;
    let cancelled = false;
    fetch("/api/render-markdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, itemId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const html = typeof d.html === "string" ? d.html : "";
        cachePut(cacheKey(itemId, text), html);
        if (!cancelled) setRendered(html);
      })
      .catch(() => {
        if (!cancelled) setFailed(text);
      });
    return () => {
      cancelled = true;
    };
  }, [text, itemId]);

  if (!text.trim()) {
    return <div className="ledgr-prose ledgr-preview" />;
  }
  // The HTML to show, DERIVED in render (no setState): the cache for the current
  // text if we have it (instant, no flash), otherwise the last HTML this instance
  // fetched — which may be for a slightly older `text` while a fresh render is in
  // flight. Keeping that stale HTML on screen is what makes an update "quiet": the
  // text changes in place when the new HTML lands, with no blank frame between.
  const html = HTML_CACHE.get(cacheKey(itemId, text)) ?? rendered;
  if (html != null) {
    return (
      <div
        className="ledgr-prose ledgr-preview"
        onContextMenu={(e) => {
          if (!deskSendAvailable()) return;
          const a = (e.target as Element).closest?.('a[href^="/items/"]');
          const linkedId = itemIdFromHref(a?.getAttribute("href"));
          if (!linkedId) return;
          e.preventDefault();
          openDeskSendMenu({
            itemId: linkedId,
            currentItemId: itemId,
            x: e.clientX,
            y: e.clientY,
          });
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (failed === text) {
    return (
      <div className="px-1 py-3 text-sm text-red-400">
        Couldn’t render preview. Switch to Source to read the raw markdown.
      </div>
    );
  }
  return <div className="px-1 py-3 text-sm text-neutral-500">Rendering…</div>;
}
