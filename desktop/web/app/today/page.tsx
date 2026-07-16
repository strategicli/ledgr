"use client";

// Desktop Today: open, not-done tasks whose plan date (scheduled ?? due) is
// today or overdue. A simple client-side filter over the task list via the seam
// (the cloud's richer Today/agenda view is a later port). ADR-139.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TodayPage() {
  const router = useRouter();
  const [items, setItems] = useState<ItemRow[] | null>(null);

  const load = useCallback(() => {
    apiRequest<{ items?: ItemRow[] }>("/api/items?type=task&limit=500")
      .then((d) => {
        const today = todayYmd();
        const due = (d.items ?? []).filter((it) => {
          if (it.statusCategory === "done") return false;
          const plan = it.scheduledDate ?? it.dueDate;
          return !!plan && String(plan).slice(0, 10) <= today;
        });
        setItems(due);
      })
      .catch(() => setItems([]));
  }, []);

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

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Today</h1>
      {items === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : (
        <ItemRows items={items} empty="Nothing due today." onOpen={open} onToggle={toggle} />
      )}
    </section>
  );
}
