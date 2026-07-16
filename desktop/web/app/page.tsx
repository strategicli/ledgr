"use client";

// The desktop dashboards screen: a thin client loader that fetches via the seam
// (window.__ledgrDesktop → IPC → @/lib → PGlite) and renders the SAME shared
// <DashboardsList> the cloud server page renders. Proves shared-component reuse
// across the Next-export boundary (ADR-139) — one view, per-target data-fetch.
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import DashboardsList, {
  type DashboardListItem,
} from "@/components/dashboards/DashboardsList";

export default function Home() {
  const [dashboards, setDashboards] = useState<DashboardListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ dashboards?: DashboardListItem[] }>("/api/dashboards")
      .then((d) => {
        const list = d.dashboards ?? [];
        setDashboards(list);
        console.log(`[page] dashboards: ${list.length}`);
      })
      .catch((e) => {
        const msg = e?.message ?? String(e);
        setError(msg);
        console.log("[page] error: " + msg);
      });
  }, []);

  if (error) {
    return (
      <main style={{ font: "14px system-ui", margin: "2rem", color: "#b00" }}>
        Error: {error}
      </main>
    );
  }
  if (!dashboards) {
    return (
      <main style={{ font: "14px system-ui", margin: "2rem", color: "#555" }}>
        loading…
      </main>
    );
  }
  return <DashboardsList dashboards={dashboards} />;
}
