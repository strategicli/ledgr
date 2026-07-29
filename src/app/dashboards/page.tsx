// Dashboards index: the owner's dashboards, each a link into its grid, plus the
// management affordances (rename, duplicate, delete + undo, drag-reorder) and
// which board is assigned as Home / Today. Server component: it fetches and
// renders; DashboardIndexList owns every interaction.
import { redirect } from "next/navigation";
import DashboardIndexList from "@/components/dashboards/DashboardIndexList";
import NewDashboardButton from "@/components/dashboards/NewDashboardButton";
import { listDashboards } from "@/lib/dashboards";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function DashboardsIndex() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [dashboards, settings] = await Promise.all([
    listDashboards(owner.id),
    getSettings(owner.id),
  ]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="ui-title text-ink">Dashboards</h1>
          <NewDashboardButton />
        </div>

        {/* Keyed on the id set so a create/duplicate/undo/reorder round-trip
            remounts the list with fresh server state (its local list is
            optimistic and only seeds at mount). A rename changes no ids, so it
            keeps the client's optimistic name without a remount. */}
        <DashboardIndexList
          key={dashboards.map((d) => d.id).join(",")}
          dashboards={dashboards}
          homeId={settings.homeDashboardId}
          todayId={settings.todayDashboardId}
        />
      </div>
    </main>
  );
}
