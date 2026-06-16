// The view builder/manager (ADR-063, producer surface). The Build side of the
// producer/consumer split: where you *create, edit, and manage* saved views.
// `/views` stays on the Work side as the consumer (browse/open/run them). This is
// what the INTERFACE → Views sidebar entry points at.
//
// Coordinated with Brandon (he built the original /build "Views" card pointing at
// /views): the builder routes themselves (/views/new, /views/[id]/edit) stay put
// for now — this manager links into them — and could move under /build/views
// later. The view engine + definitions are shared surfaces.
import Link from "next/link";
import { redirect } from "next/navigation";
import { usedViewIds } from "@/lib/dashboards";
import { resolveOwner } from "@/lib/owner";
import { listViews } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function BuildViews() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [views, used] = await Promise.all([listViews(owner.id), usedViewIds(owner.id)]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Views
          </h1>
          <Link
            href="/views/new"
            className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            New view
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Create and manage saved views: list, table, board, calendar, or agenda.
          Add a view to a{" "}
          <Link href="/dashboards" className="text-neutral-400 hover:text-neutral-200">
            dashboard
          </Link>{" "}
          (from its Edit → Add widget menu) to surface it on Work as a widget. Open a view
          from{" "}
          <Link href="/views" className="text-neutral-400 hover:text-neutral-200">
            Work → Views
          </Link>
          .
        </p>

        {views.length > 0 ? (
          <ul className="mt-6 flex flex-col gap-1">
            {views.map((view) => (
              <li
                key={view.id}
                className="flex items-center gap-3 rounded px-2 py-2 hover:bg-neutral-800/60"
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
                <Link
                  href={`/views/${view.id}/edit`}
                  className="shrink-0 rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 px-2 text-sm text-neutral-600">
            No views yet. Build one to get started.
          </p>
        )}
      </div>
    </main>
  );
}
