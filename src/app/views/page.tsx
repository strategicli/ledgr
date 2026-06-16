// Views index — the Work-side *consumer* surface (ADR-063 producer/consumer
// split): browse and open your saved views to run them. Creating, editing, and
// managing views lives on the Build side (/build/views). A view that's placed on
// a dashboard is also a "widget" (same object, different use); the filter tabs
// and the badge surface that, derived from usedViewIds (dashboards epoch).
import Link from "next/link";
import { redirect } from "next/navigation";
import { usedViewIds } from "@/lib/dashboards";
import { resolveOwner } from "@/lib/owner";
import { listViews } from "@/lib/views";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "views", label: "Views" },
  { key: "widgets", label: "Widgets" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default async function Views({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const raw = (await searchParams).filter;
  const filter: FilterKey = FILTERS.some((f) => f.key === raw) ? (raw as FilterKey) : "all";

  const [allViews, used] = await Promise.all([listViews(owner.id), usedViewIds(owner.id)]);
  const views = allViews.filter((v) =>
    filter === "widgets" ? used.has(v.id) : filter === "views" ? !used.has(v.id) : true
  );

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Views</h1>
          <Link
            href="/build/views"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Manage in Build →
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Saved ways to slice your items: list, table, board, calendar, or agenda. A view
          placed on a dashboard is also a <span className="text-neutral-400">widget</span>.
        </p>

        <div className="mt-4 flex gap-1 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/views" : `/views?filter=${f.key}`}
              className={`rounded-md px-2.5 py-1 ${
                filter === f.key
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {views.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1">
            {views.map((view) => (
              <li key={view.id}>
                <Link
                  href={`/views/${view.id}`}
                  className="group flex items-center gap-3 rounded px-2 py-2 hover:bg-neutral-800/60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                    {view.name}
                  </span>
                  {used.has(view.id) && (
                    <span className="shrink-0 rounded-full border border-[var(--accent)] px-1.5 py-0.5 text-xs text-[var(--accent)]">
                      widget
                    </span>
                  )}
                  <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {view.layout}
                  </span>
                  {view.isSystem && (
                    <span className="shrink-0 text-xs text-neutral-600">system</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 px-2 text-sm text-neutral-600">
            {filter === "widgets"
              ? "No views are on a dashboard yet."
              : filter === "views"
                ? "Every view is in use as a widget."
                : "No views yet. Build one to get started."}
          </p>
        )}
      </div>
    </main>
  );
}
