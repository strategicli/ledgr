// Discover related (ADR-127): a collapsible section under "Linked here" that
// surfaces items worth linking but not linked yet, deterministically ranked,
// each with a reason chip and a one-click Link. Fetches once on mount — a cheap
// item_relatedness cache read (live-compute fallback on a miss) — so the section
// auto-hides when nothing clears the floor and the header can show the count.
// Collapsed by default (native <details>, the canvas's established pattern) so
// the rows render only when the user opens it. Link writes a real `related`
// edge (the same POST as "+ Relate"); the row then graduates up into Linked
// here on refresh.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Suggestion = {
  id: string;
  type: string;
  title: string;
  signals: { kind: string; label: string }[];
};

const PAGE = 8;

export default function DiscoverPanel({
  itemId,
  anchorTitle = "",
  bare = false,
}: {
  itemId: string;
  anchorTitle?: string;
  bare?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [linking, setLinking] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/items/${itemId}/suggested-relations?limit=${PAGE}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          candidates: Suggestion[];
          nextOffset: number | null;
        };
        setRows(data.candidates);
        setNextOffset(data.nextOffset);
        setStatus("ready");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setStatus("error");
      }
    })();
    return () => ctrl.abort();
  }, [itemId]);

  const loadMore = useCallback(async () => {
    if (nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/items/${itemId}/suggested-relations?limit=${PAGE}&offset=${nextOffset}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        candidates: Suggestion[];
        nextOffset: number | null;
      };
      setRows((prev) => [...(prev ?? []), ...data.candidates]);
      setNextOffset(data.nextOffset);
    } catch {
      // leave the button in place; a retry click re-tries.
    }
    setLoadingMore(false);
  }, [itemId, nextOffset, loadingMore]);

  async function link(s: Suggestion) {
    if (linking) return;
    setLinking(s.id);
    try {
      const res = await fetch(`/api/items/${itemId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: s.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // It's a real edge now: drop it here, let the Related panel pick it up.
      setRows((prev) => (prev ?? []).filter((r) => r.id !== s.id));
      router.refresh();
    } catch {
      // keep the row so the user can retry.
    } finally {
      setLinking(null);
    }
  }

  // Auto-hide: still loading, failed, or nothing cleared the floor.
  if (status !== "ready" || !rows || rows.length === 0) return null;

  const inner = (
    <details className="canvas-section">
      <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--cs-label)] hover:text-neutral-300">
        <span>Discover related</span>
        <span className="canvas-section-count">{rows.length}</span>
      </summary>
      <ul className="mt-2">
        {rows.map((s) => (
          <li
            key={s.id}
            className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60"
          >
            <Link
              href={`/items/${s.id}`}
              className={`min-w-0 flex-1 truncate text-sm hover:underline ${
                s.title ? "text-neutral-200" : "text-neutral-500"
              }`}
            >
              {s.title || "Untitled"}
            </Link>
            {s.signals.slice(0, 2).map((sig, i) => (
              <span
                key={i}
                className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400"
              >
                {sig.label}
              </span>
            ))}
            <span className="shrink-0 text-xs text-neutral-600">{s.type}</span>
            <button
              onClick={() => link(s)}
              disabled={linking === s.id}
              className="shrink-0 rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
            >
              {linking === s.id ? "Linking…" : "+ Link"}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3 px-2">
        {nextOffset != null && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Show more"}
          </button>
        )}
        <Link
          href={`/search?q=${encodeURIComponent(anchorTitle)}`}
          className="ml-auto text-xs text-neutral-600 hover:text-neutral-300"
        >
          Search everything about this →
        </Link>
      </div>
    </details>
  );

  return bare ? (
    inner
  ) : (
    <div className="canvas-section-wrap mx-auto w-full max-w-3xl px-2 sm:px-8 md:px-12">
      {inner}
    </div>
  );
}
