"use client";

// Desktop "new view": reuses the real cloud ViewBuilder form (client component)
// over the seam. On save, onSaved routes to the desktop /view?id=… (the cloud's
// built-in /views/:id nav doesn't exist here). ADR-139.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import ViewBuilder from "@/components/views/ViewBuilder";

type TypeRow = { key: string; label: string; propertySchema?: unknown; statusMode?: unknown };

export default function NewViewPage() {
  const router = useRouter();
  const [types, setTypes] = useState<TypeRow[] | null>(null);
  const [people, setPeople] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    apiRequest<{ types?: TypeRow[] }>("/api/types")
      .then((d) => setTypes(d.types ?? []))
      .catch(() => setTypes([]));
    apiRequest<{ items?: { id: string; title: string | null }[] }>("/api/items?type=person&limit=200")
      .then((d) => setPeople((d.items ?? []).map((p) => ({ id: p.id, title: p.title ?? "" }))))
      .catch(() => {});
  }, []);

  if (types === null) return <section className="p-6 text-neutral-500">loading…</section>;

  return (
    <section className="p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-neutral-100">New view</h1>
        <Link href="/views" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← All views
        </Link>
      </div>
      <div className="mt-4">
        <ViewBuilder
          people={people}
          types={types.map((t) => ({
            key: t.key,
            label: t.label,
            propertySchema: t.propertySchema as never,
            statusMode: t.statusMode as never,
          }))}
          onSaved={(id) => router.push(`/view?id=${id}`)}
        />
      </div>
    </section>
  );
}
