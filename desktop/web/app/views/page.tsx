"use client";

// Desktop saved-views index: lists the owner's views (GET /api/views), each
// opening into /view?id=…. ADR-139.
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

type ViewRow = { id: string; name: string };

export default function ViewsPage() {
  const [views, setViews] = useState<ViewRow[] | null>(null);

  useEffect(() => {
    apiRequest<{ views?: ViewRow[] }>("/api/views")
      .then((d) => setViews(d.views ?? []))
      .catch(() => setViews([]));
  }, []);

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Views</h1>
      {views === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : views.length ? (
        <ul className="mt-3 flex list-none flex-col p-0">
          {views.map((v) => (
            <li key={v.id} className="border-b border-neutral-800 py-2">
              <Link
                href={`/view?id=${v.id}`}
                className="text-neutral-200 no-underline hover:underline"
              >
                {v.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-neutral-500">No saved views yet.</p>
      )}
    </section>
  );
}
