// Create a dashboard and jump into it. Minimal for now (a name prompt); the
// richer create flow (widgets, focus) is the dashboard editor in later slices.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewDashboardButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    const name = window.prompt("Dashboard name?", "New dashboard")?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, focusItemId: null, widgets: [] }),
      });
      if (!res.ok) throw new Error("create failed");
      const { dashboard } = (await res.json()) as { dashboard: { id: string } };
      router.push(`/dashboards/${dashboard.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={create}
      disabled={busy}
      className="rounded-md border border-[var(--accent)] px-3 py-1 text-sm text-[var(--accent)] hover:opacity-90 disabled:opacity-50"
    >
      {busy ? "Creating…" : "New dashboard"}
    </button>
  );
}
