"use client";

// Desktop "new type": reuses the real cloud TypeBuilder form over the seam. On
// save, onSaved routes to the new type's list (/list?type=…). ADR-139.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import TypeBuilder from "@/components/build/TypeBuilder";

type TypeRow = { key: string; label: string };

export default function NewTypePage() {
  const router = useRouter();
  const [types, setTypes] = useState<TypeRow[] | null>(null);

  useEffect(() => {
    apiRequest<{ types?: TypeRow[] }>("/api/types")
      .then((d) => setTypes(d.types ?? []))
      .catch(() => setTypes([]));
  }, []);

  if (types === null) return <section className="p-6 text-neutral-500">loading…</section>;

  return (
    <section className="p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-neutral-100">New type</h1>
        <Link href="/build" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Build
        </Link>
      </div>
      <div className="mt-4">
        <TypeBuilder
          availableTypes={types.map((t) => ({ key: t.key, label: t.label }))}
          onSaved={(key) => router.push(`/list?type=${key}`)}
        />
      </div>
    </section>
  );
}
