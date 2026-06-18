// "Roll N overdue → today" — the deterministic overdue auto-roll as a one-click
// action on Today (T2, ADR-073). Pulls every overdue planned task forward to
// today via POST /api/tasks/roll-overdue, then refreshes. Shown only when there
// is something to roll (the parent passes the count).
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RollOverdueButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (count <= 0) return null;

  async function roll() {
    setBusy(true);
    try {
      const res = await fetch("/api/tasks/roll-overdue", { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={roll}
      disabled={busy}
      className="rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
      title="Move overdue tasks' planned date to today"
    >
      {busy ? "Rolling…" : `Roll ${count} overdue → today`}
    </button>
  );
}
