// Create a dashboard and jump into it. The name is captured with an inline
// input (was a native window.prompt, which broke the dark aesthetic and read
// poorly on mobile); the richer create flow (widgets, focus) is the dashboard
// editor in later slices.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewDashboardButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function create() {
    const trimmed = name.trim() || "New dashboard";
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, focusItemId: null, widgets: [] }),
      });
      if (!res.ok) throw new Error("create failed");
      const { dashboard } = (await res.json()) as { dashboard: { id: string } };
      router.push(`/dashboards/${dashboard.id}`);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  function cancel() {
    setOpen(false);
    setName("");
    setError(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--accent)] px-3 py-1 text-sm text-[var(--accent)] hover:opacity-90"
      >
        New dashboard
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") cancel();
        }}
        placeholder="Dashboard name"
        disabled={busy}
        aria-label="Dashboard name"
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-500 disabled:opacity-50"
      />
      <button
        onClick={() => void create()}
        disabled={busy}
        className="rounded-md border border-[var(--accent)] px-3 py-1 text-sm text-[var(--accent)] hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create"}
      </button>
      <button
        onClick={cancel}
        disabled={busy}
        className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-400">Failed, try again</span>}
    </span>
  );
}
