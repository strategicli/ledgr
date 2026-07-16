"use client";

// Desktop Build index: entry points for the authoring surfaces (new type / new
// view) + the type list. ADR-139.
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

type TypeRow = { key: string; label: string };
const btn =
  "rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-200 no-underline hover:bg-neutral-800";

export default function BuildPage() {
  const [types, setTypes] = useState<TypeRow[]>([]);

  useEffect(() => {
    apiRequest<{ types?: TypeRow[] }>("/api/types")
      .then((d) => setTypes(d.types ?? []))
      .catch(() => {});
  }, []);

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Build</h1>
      <div className="mt-4 flex gap-2">
        <Link href="/type/new" className={btn}>
          New type
        </Link>
        <Link href="/view/new" className={btn}>
          New view
        </Link>
      </div>
      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Types
      </h2>
      <ul className="mt-2 flex list-none flex-col p-0">
        {types.map((t) => (
          <li key={t.key} className="border-b border-neutral-800 py-2">
            <Link
              href={`/list?type=${t.key}`}
              className="text-neutral-200 no-underline hover:underline"
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
