// Per-row triage cluster for the Inbox: retype the item, mark it triaged, or
// send it to Trash. Deliberately explicit (rule 3): nothing leaves the Inbox
// unless a control here said so. The Inbox doubles as a filter — much of what
// lands here is junk to clear fast — so Delete is a visible, one-tap button
// (not menu-only), alongside Triaged. Both carry a color cue (faint green /
// faint red) + an icon. Delete is a soft-delete with an undo toast (the safety
// net, ADR-142); deeper triage (relations, body) happens in the canvas.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/ui/ActionToast";

function I({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
      {extra}
    </svg>
  );
}
const IconCheck = <I d="M20 6L9 17l-5-5" />;
const IconTrash = <I d="M4 7h16M10 11v6M14 11v6" extra={<path d="M6 7l1 13h10l1-13M9 7V4h6v3" />} />;

export default function TriageControls({
  id,
  type,
  typeOptions,
  label,
}: {
  id: string;
  type: string;
  typeOptions: { key: string; label: string }[];
  label?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function patch(body: Record<string, unknown>) {
    setState("busy");
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  async function trash() {
    setState("busy");
    try {
      const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setState("idle");
      router.refresh();
      showToast(`${label ? `"${label}" ` : ""}moved to Trash`, () =>
        void fetch(`/api/items/${id}/restore`, { method: "POST" }).then(() => router.refresh())
      );
    } catch {
      setState("error");
    }
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      {state === "error" && <span className="text-xs text-red-400">Failed</span>}
      <select
        value={type}
        disabled={state === "busy"}
        aria-label="Type"
        onChange={(e) => void patch({ type: e.target.value })}
        className="rounded-card border border-line bg-surface-1 px-1 py-0.5 text-xs text-ink-muted outline-none focus:border-line-strong"
      >
        {typeOptions.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => void patch({ inbox: false })}
        disabled={state === "busy"}
        title="Mark triaged (remove from Inbox)"
        className="inline-flex items-center gap-1 rounded-card border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
      >
        {IconCheck} Triaged
      </button>
      <button
        onClick={() => void trash()}
        disabled={state === "busy"}
        title="Move to Trash"
        aria-label="Move to Trash"
        className="inline-flex items-center gap-1 rounded-card border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
      >
        {IconTrash}
      </button>
    </span>
  );
}
