// Loads one dashboard and renders its grid — the reusable core shared by the
// /dashboards/[id] route and the Home/Today surfaces (when a dashboard is
// assigned there). Server component: the per-widget fan-out lives in
// resolveDashboardData (src/lib/dashboard-resolve.ts, shared with the Desk's
// read-only dashboard panel); this resolves the home/today roles and hands the
// resolved widgets to the client grid. Returns the fallback (or 404s) when the
// dashboard is missing/unowned.
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import DashboardClient from "@/components/dashboards/DashboardClient";
import { resolveDashboardData } from "@/lib/dashboard-resolve";
import { appTodayYmd } from "@/lib/recurrence-service";
import { getSettings } from "@/lib/settings";
import { getAppTimezone } from "@/lib/today";

// Rendered as JSX (a normal async Server Component). When the dashboard is
// missing/unowned: render `fallback` if given (the Home/Today surfaces pass the
// fixed Today layout), otherwise 404 (the /dashboards/[id] route).
export default async function DashboardView({
  ownerId,
  dashboardId,
  fallback,
}: {
  ownerId: string;
  dashboardId: string;
  fallback?: ReactNode;
}) {
  const resolved = await resolveDashboardData(ownerId, dashboardId);
  if (!resolved) {
    if (fallback !== undefined) return <>{fallback}</>;
    notFound();
  }

  const settings = await getSettings(ownerId);
  // App-timezone "today" (YYYY-MM-DD), resolved server-side exactly as
  // /views/[id] does, so SSR and the client's first render agree. It's what turns
  // every widget row interactive (ADR-142: Complete / Focus / Schedule / Trash).
  const tz = await getAppTimezone(ownerId);

  return (
    <DashboardClient
      today={appTodayYmd(new Date(), tz)}
      dashboardId={resolved.id}
      name={resolved.name}
      focusItemId={resolved.focusItemId}
      focusTitle={resolved.focusTitle}
      appearance={resolved.appearance}
      isHome={settings.homeDashboardId === resolved.id}
      isToday={settings.todayDashboardId === resolved.id}
      initialWidgets={resolved.widgets}
    />
  );
}
