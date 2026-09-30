// The Publish control (explorations/website-pages.md): publishing is an
// explicit act, so it sits in an item's "Export & sharing" section beside the
// Share link, and shows plainly where the item is public. That is all it does:
// a Website Page's own options (its link, Design, and the pages it publishes)
// live at the top of the page (PageHeader), so on a page this renders nothing.
"use client";

import { useEffect, useState } from "react";

type PageRow = { id: string; title: string; published: boolean; slug: string | null; at: string | null };

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PublishControl({ itemId }: { itemId: string }) {
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [isPage, setIsPage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/items/${itemId}/publish`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { pages: PageRow[]; isPage: boolean } | null) => {
        if (cancelled || !data) return;
        setPages(data.pages);
        setIsPage(data.isPage);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function toggle(pageId: string, publish: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/publish`, {
        method: publish ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) throw new Error(`failed (${res.status})`);
      const data = (await res.json()) as { slug?: string; at?: string };
      setPages((prev) =>
        (prev ?? []).map((p) =>
          p.id === pageId ? { ...p, published: publish, slug: data.slug ?? null, at: data.at ?? null } : p
        )
      );
    } catch {
      setError(publish ? "Couldn't publish. Try again." : "Couldn't unpublish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (pages === null || isPage) return null;
  const live = pages.filter((p) => p.published);

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {pages.length === 0 ? (
        <span className="text-neutral-500">Publish: make a Website Page first, then publish items to it from here.</span>
      ) : (
        <>
          {live.length > 0 && <span className="text-neutral-300">Public on: {live.map((p) => p.title).join(", ")}</span>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-400">Publish to</span>
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                aria-pressed={p.published}
                onClick={() => toggle(p.id, !p.published)}
                title={p.published ? `Published ${day(p.at)}. Click to unpublish.` : "Publish to this page"}
                className={`rounded border px-2 py-0.5 disabled:opacity-50 ${
                  p.published
                    ? "border-[var(--accent)] text-neutral-100"
                    : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {p.published ? "✓ " : ""}
                {p.title}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <span className="text-red-400">{error}</span>}
    </div>
  );
}
