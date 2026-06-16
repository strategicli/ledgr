// A customizable dashboard (dashboards epoch): the owner's widgets in a
// resizable/draggable grid. Thin wrapper over DashboardView (the shared loader,
// reused by the Home/Today surfaces); 404s if the dashboard is missing/unowned.
import { redirect } from "next/navigation";
import DashboardView from "@/components/dashboards/DashboardView";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export default async function DashboardPage({ params }: Context) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { id } = await params;
  // DashboardView 404s itself when the id is missing/unowned (no fallback).
  return <DashboardView ownerId={owner.id} dashboardId={id} />;
}
