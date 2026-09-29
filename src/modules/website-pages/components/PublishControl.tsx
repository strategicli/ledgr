// The Publish control (explorations/website-pages.md): publishing is an
// explicit act, so it sits in the item's "Export & sharing" section beside the
// Share link, and shows plainly where the item is public. On a Website Page it
// shows the other half: everything that page exposes, each with Unpublish.
"use client";

import { useEffect, useState } from "react";
import PageControls, { type PageInfo } from "@/modules/website-pages/components/PageControls";

type PageRow = { id: string; title: string; published: boolean; slug: string | null; at: string | null };
type Exposed = { id: string; title: string; slug: string; publishedAt: string };

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PublishControl({ itemId }: { itemId: string }) {
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [exposes, setExposes] = useState<Exposed[] | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/items/${itemId}/publish`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { pages: PageRow[]; exposes: Exposed[] | null; page: PageInfo | null } | null) => {
        if (cancelled || !data) return;
        setPages(data.pages);
        setExposes(data.exposes);
        setPage(data.page);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Publish/unpublish THIS item on a page, or (from a page's exposure list)
  // take another item off this page.
  async function toggle(target: string, pageId: string, publish: boolean) {
    if (busy) return;
    setBusy(`${target}:${pageId}`);
    setError("");
    try {
      const res = await fetch(`/api/items/${target}/publish`, {
        method: publish ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) throw new Error(`failed (${res.status})`);
      const data = (await res.json()) as { slug?: string; at?: string };
      if (target === itemId) {
        setPages((prev) =>
          (prev ?? []).map((p) =>
            p.id === pageId ? { ...p, published: publish, slug: data.slug ?? null, at: data.at ?? null } : p
          )
        );
      } else {
        setExposes((prev) => (prev ?? []).filter((e) => e.id !== target));
      }
    } catch {
      setError(publish ? "Couldn't publish. Try again." : "Couldn't unpublish. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (pages === null) return null;
  const live = pages.filter((p) => p.published);

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {exposes !== null ? (
        <>
          {page && <PageControls itemId={itemId} initial={page} />}
          <span className="text-neutral-400">
            {exposes.length
              ? `This page publishes ${exposes.length} item${exposes.length === 1 ? "" : "s"}. Anyone with its link can open these:`
              : "This page publishes nothing yet. Use Publish on any item to add it."}
          </span>
          {exposes.length > 0 && (
            <ul className="flex flex-col gap-1">
              {exposes.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <a href={`/items/${e.id}`} className="min-w-0 truncate text-neutral-300 hover:text-neutral-100">
                    {e.title}
                  </a>
                  <span className="shrink-0 text-neutral-600">{day(e.publishedAt)}</span>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => toggle(e.id, itemId, false)}
                    className="shrink-0 text-neutral-500 hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    Unpublish
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : pages.length === 0 ? (
        <span className="text-neutral-500">
          Publish: make a Website Page first, then publish items to it from here.
        </span>
      ) : (
        <>
          {live.length > 0 && (
            <span className="text-neutral-300">
              Public on: {live.map((p) => p.title).join(", ")}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-400">Publish to</span>
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!!busy}
                aria-pressed={p.published}
                onClick={() => toggle(itemId, p.id, !p.published)}
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
