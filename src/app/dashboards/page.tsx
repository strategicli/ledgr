// Dashboards index: the owner's dashboards, each a link into its grid. Minimal
// for now — the switcher, nav destinations, and Home/Today assignment land in
// slice 7. Server component.
import Link from "next/link";
import { redirect } from "next/navigation";
import NewDashboardButton from "@/components/dashboards/NewDashboardButton";
import { listDashboards } from "@/lib/dashboards";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

export default async function DashboardsIndex() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const dashboards = await listDashboards(owner.id);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Dashboards</h1>
          <NewDashboardButton />
        </div>

        {dashboards.length > 0 ? (
          <ul className="mt-6 flex flex-col gap-2">
            {dashboards.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/dashboards/${d.id}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-neutral-700"
                >
                  <span className="font-medium text-neutral-200">{d.name}</span>
                  <span className="text-xs text-neutral-500">
                    {d.widgets.length} widget{d.widgets.length === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 text-sm text-neutral-600">
            No dashboards yet. Create one to start arranging widgets.
          </p>
        )}
      </div>
    </main>
  );
}
