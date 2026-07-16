"use client";

// Desktop Search: FTS over the local DB via the seam (GET /api/search?q=…),
// results open in the detail screen. ADR-139.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";

export default function SearchPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ItemRow[] | null>(null);

  const run = useCallback(() => {
    const query = q.trim();
    if (!query) {
      setResults(null);
      return;
    }
    apiRequest<{ items?: ItemRow[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=100`)
      .then((d) => setResults(d.items ?? []))
      .catch(() => setResults([]));
  }, [q]);

  const open = useCallback((id: string) => router.push(`/item?id=${id}`), [router]);

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Search</h1>
      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-1.5 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          value={q}
          placeholder="Search titles and content…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
        />
        <button
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          onClick={run}
          disabled={!q.trim()}
        >
          Search
        </button>
      </div>
      {results === null ? (
        <p className="mt-3 text-sm text-neutral-500">Type a query and press Enter.</p>
      ) : (
        <ItemRows items={results} empty="No matches." onOpen={open} />
      )}
    </section>
  );
}
