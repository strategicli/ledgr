"use client";

// Desktop saved-view: /view?id=… runs the view (getView → queryViewItems over
// the seam) and renders by the view's layout — list/agenda via <ItemRows>,
// table/board/calendar via the lightweight <ViewLayouts> renderers. The heavy
// interactive layouts (drag board, planner time-grid) stay in the cloud app.
// ADR-139.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import type { ViewDefinition } from "@/lib/views";
import ViewLayouts, { type WireItem } from "./ViewLayouts";

function ViewInner() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [view, setView] = useState<ViewDefinition | null>(null);
  const [items, setItems] = useState<WireItem[] | null>(null);

  const load = useCallback(() => {
    if (!id) {
      setItems([]);
      return;
    }
    apiRequest<{ view?: ViewDefinition }>(`/api/views/${id}`)
      .then((d) => {
        if (d.view) setView(d.view);
      })
      .catch(() => {});
    apiRequest<{ items?: WireItem[] }>(`/api/views/${id}/items`)
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

  const layoutLabel = view && view.layout !== "list" ? ` · ${view.layout}` : "";

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">
        {view?.name ?? "View"}
        <span className="text-sm font-normal text-neutral-600">{layoutLabel}</span>
      </h1>
      {items === null || view === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : (
        <ViewLayouts view={view} items={items} onOpen={open} onToggle={toggle} />
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
