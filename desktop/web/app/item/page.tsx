"use client";

// Desktop item detail: open an item to view/edit it. Uses query-param routing
// (/item?id=…) to stay a static route (no generateStaticParams needed for the
// export). Reuses the REAL cloud editor stack (ItemEditor → Tiptap) + the
// save-status/conflict indicator; their raw fetch("/api/…") saves travel over
// the IPC seam via the fetch shim (layout.tsx). ADR-139.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import SaveStatusIndicator from "@/components/canvas/SaveStatusIndicator";

type LoadedItem = { id: string; title: string; body: unknown; updatedAt: string };

function ItemDetail() {
  const id = useSearchParams().get("id") ?? "";
  const [item, setItem] = useState<LoadedItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("no item id");
      return;
    }
    apiRequest<{ item?: LoadedItem }>(`/api/items/${id}`)
      .then((d) => {
        setItem(d.item ?? null);
        console.log("[page] item: " + (d.item?.title ?? "(none)"));
      })
      .catch((e) => {
        setError(e?.message ?? String(e));
        console.log("[page] item error: " + (e?.message ?? String(e)));
      });
  }, [id]);

  if (error) return <section className="p-6 text-red-400">Error: {error}</section>;
  if (!item) return <section className="p-6 text-neutral-500">loading…</section>;

  const loadedAt = item.updatedAt
    ? new Date(item.updatedAt).toISOString()
    : new Date().toISOString();

  return (
    <section className="mx-auto max-w-3xl p-6">
      <ItemEditor item={{ id: item.id, title: item.title, body: item.body }} />
      <SaveStatusIndicator itemId={item.id} loadedAt={loadedAt} />
    </section>
  );
}

export default function ItemPage() {
  return (
    <Suspense fallback={<section className="p-6 text-neutral-500">loading…</section>}>
      <ItemDetail />
    </Suspense>
  );
}
