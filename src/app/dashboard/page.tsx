// Widget dashboard (slice 29, PRD §4.11): the pinned views as cards. Each
// widget's preview and badge come from the shared owner-scoped, body-free
// query, capped to a small preview; the true count rides alongside. Arrangement
// and the equal-height toggle live in the client grid.
import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardGrid, {
  type DashboardWidget,
} from "@/components/views/DashboardGrid";
import { resolveOwner } from "@/lib/owner";
import { countViewItems, listDashboardViews, queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

const PREVIEW = 8;

export default async function Dashboard() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const views = await listDashboardViews(owner.id);
  const widgets: DashboardWidget[] = await Promise.all(
    views.map(async (view) => {
      const [items, count] = await Promise.all([
        queryViewItems(owner.id, view.filter, view.sort, PREVIEW),
        countViewItems(owner.id, view.filter),
      ]);
      return {
        id: view.id,
        name: view.name,
        layout: view.layout,
        count,
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          type: i.type,
          status: i.status,
          dueDate: i.dueDate ? i.dueDate.toISOString() : null,
        })),
      };
    })
  );

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            Dashboard
          </h1>
          <Link
            href="/views"
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Manage views →
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Your pinned views, at a glance. Drag a card to rearrange.
        </p>

        {widgets.length > 0 ? (
          <DashboardGrid initial={widgets} />
        ) : (
          <p className="mt-8 px-2 text-sm text-neutral-600">
            No widgets yet. Open a{" "}
            <Link href="/views" className="text-neutral-400 hover:text-neutral-200">
              view
            </Link>{" "}
            and pin it to the dashboard.
          </p>
        )}
      </div>
    </main>
  );
}
