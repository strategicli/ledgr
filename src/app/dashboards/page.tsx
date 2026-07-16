// Dashboards index: the owner's dashboards, each a link into its grid. The
// cloud page stays a Server Component (SSR): it fetches server-side and renders
// the shared <DashboardsList> view. The desktop build renders the SAME view
// from a client loader that fetches via the seam (ADR-139) — the view is shared,
// only the data-fetch differs per target.
import { redirect } from "next/navigation";
import DashboardsList from "@/components/dashboards/DashboardsList";
import { listDashboards } from "@/lib/dashboards";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

export default async function DashboardsIndex() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const dashboards = await listDashboards(owner.id);
  return <DashboardsList dashboards={dashboards} />;
}
