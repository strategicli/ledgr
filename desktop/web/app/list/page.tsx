"use client";

// Generic per-type list: /list?type=<key> (query-param route, export-friendly).
// Covers any type (person, tag, event, module types) with the shared <ItemRows>
// + quick-add, opening items in the detail screen. ADR-139.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";
import QuickAddItem from "@/components/QuickAddItem";

function ListInner() {
  const type = useSearchParams().get("type") ?? "note";
  const router = useRouter();
  const [items, setItems] = useState<ItemRow[] | null>(null);

  const load = useCallback(() => {
    apiRequest<{ items?: ItemRow[] }>(
      `/api/items?type=${encodeURIComponent(type)}&limit=200`
    )
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback((id: string) => router.push(`/item?id=${id}`), [router]);
  const toggle = useCallback(
    (id: string) => {
      apiRequest(`/api/items/${id}/complete`, { method: "POST" }).then(load).catch(() => {});
    },
    [load]
  );
  const remove = useCallback(
    (id: string) => {
      apiRequest(`/api/items/${id}`, { method: "DELETE" }).then(load).catch(() => {});
    },
    [load]
  );

  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">{label}</h1>
      <QuickAddItem type={type} placeholder={`Add a ${type}…`} onCreated={load} />
      {items === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : (
        <ItemRows
          items={items}
          empty={`No ${type} items yet.`}
          onOpen={open}
          onToggle={toggle}
          onDelete={remove}
        />
      )}
    </section>
  );
}

export default function ListPage() {
  return (
    <Suspense fallback={<section className="p-6 text-neutral-500">loading…</section>}>
      <ListInner />
    </Suspense>
  );
}
