import Link from "next/link";
import NewDashboardButton from "@/components/dashboards/NewDashboardButton";

// Presentational dashboards index, shared by the cloud server page (SSR) and
// the desktop client loader (CSR via the seam), ADR-139. It takes its data as
// props so the data-fetch differs per target while the view stays identical.
// No hooks / no data-fetch here, so it renders in both a server component
// (cloud) and a client tree (desktop).
export type DashboardListItem = { id: string; name: string; widgets: unknown[] };

// hrefFor / onCreated are additive hooks (defaults target the cloud
// /dashboards/:id route) so the desktop build can point at its own query-param
// page. ADR-139.
export default function DashboardsList({
  dashboards,
  hrefFor,
  onCreated,
}: {
  dashboards: DashboardListItem[];
  hrefFor?: (id: string) => string;
  onCreated?: (id: string) => void;
}) {
  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Dashboards</h1>
          <NewDashboardButton onCreated={onCreated} />
        </div>

        {dashboards.length > 0 ? (
          <ul className="mt-6 flex flex-col gap-2">
            {dashboards.map((d) => (
              <li key={d.id}>
                <Link
                  href={hrefFor ? hrefFor(d.id) : `/dashboards/${d.id}`}
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
