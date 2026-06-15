// Views index — the Work-side *consumer* surface (ADR-063 producer/consumer
// split): browse and open your saved views to run them. Creating, editing, and
// managing views lives on the Build side (/build/views). System views (none
// seeded yet) would sort to the top; today every row is a user view.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { listViews } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Views() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const views = await listViews(owner.id);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Views
          </h1>
          <Link
            href="/build/views"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Manage in Build →
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Saved ways to slice your items: list, table, board, calendar, or
          agenda. Open one to run it; create and edit them in{" "}
          <Link href="/build/views" className="text-neutral-400 hover:text-neutral-200">
            Build
          </Link>
          .
        </p>

        {views.length > 0 ? (
          <ul className="mt-6 flex flex-col gap-1">
            {views.map((view) => (
              <li key={view.id}>
                <Link
                  href={`/views/${view.id}`}
                  className="group flex items-center gap-3 rounded px-2 py-2 hover:bg-neutral-800/60"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                    {view.name}
                  </span>
                  <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {view.layout}
                  </span>
                  {view.isSystem && (
                    <span className="shrink-0 text-xs text-neutral-600">
                      system
                    </span>
                  )}
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
