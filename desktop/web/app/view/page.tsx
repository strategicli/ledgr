"use client";

// Desktop saved-view: /view?id=… runs the view (getView → queryViewItems over
// the seam) and renders results with the shared <ItemRows> (list layout; the
// board/calendar/table layouts are a later port). ADR-139.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";

function ViewInner() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [name, setName] = useState("View");
  const [items, setItems] = useState<ItemRow[] | null>(null);

  const load = useCallback(() => {
    if (!id) {
      setItems([]);
      return;
    }
    apiRequest<{ view?: { name?: string } }>(`/api/views/${id}`)
      .then((d) => {
        if (d.view?.name) setName(d.view.name);
      })
      .catch(() => {});
    apiRequest<{ items?: ItemRow[] }>(`/api/views/${id}/items`)
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback((rid: string) => router.push(`/item?id=${rid}`), [router]);
  const toggle = useCallback(
    (rid: string) => {
      apiRequest(`/api/items/${rid}/complete`, { method: "POST" }).then(load).catch(() => {});
    },
    [load]
  );

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">{name}</h1>
      {items === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : (
        <ItemRows items={items} empty="No items in this view." onOpen={open} onToggle={toggle} />
      )}
    </section>
  );
}

export default function ViewPage() {
  return (
    <Suspense fallback={<section className="p-6 text-neutral-500">loading…</section>}>
      <ViewInner />
    </Suspense>
  );
}
