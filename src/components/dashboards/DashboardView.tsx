// Loads one dashboard and renders its grid — the reusable core shared by the
// /dashboards/[id] route and the Home/Today surfaces (when a dashboard is
// assigned there). Server component: the per-widget fan-out lives in
// @/lib/dashboard-resolve (shared with the desktop data-router, ADR-139); this
// hands the resolved data to the client grid. Returns `fallback` if given (the
// Home/Today surfaces pass the fixed Today layout) when the dashboard is
// missing/unowned, otherwise 404s.
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import DashboardClient from "@/components/dashboards/DashboardClient";
import { resolveDashboard } from "@/lib/dashboard-resolve";
import { ItemError } from "@/lib/items";

export default async function DashboardView({
  ownerId,
  dashboardId,
  fallback,
}: {
  ownerId: string;
  dashboardId: string;
  fallback?: ReactNode;
}) {
  let resolved;
  try {
    resolved = await resolveDashboard(ownerId, dashboardId);
  } catch (err) {
    if (err instanceof ItemError && err.code === "not_found") {
      if (fallback !== undefined) return <>{fallback}</>;
      notFound();
    }
    throw err;
  }

  return (
    <DashboardClient
      dashboardId={resolved.id}
      name={resolved.name}
      focusItemId={resolved.focusItemId}
      focusTitle={resolved.focusTitle}
      appearance={resolved.appearance}
      isHome={resolved.isHome}
      isToday={resolved.isToday}
      initialWidgets={resolved.widgets}
    />
  );
}
