// Per-row triage controls for the Inbox: retype the item or clear it out of
// the Inbox. Deliberately explicit (rule 3): nothing leaves the Inbox unless
// a control here said so, so the flag never changes behind Brandon's back.
// Deeper triage (due date, urgency, entities) happens in the item canvas,
// one click away on the row title.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TriageControls({
  id,
  type,
  typeOptions,
}: {
  id: string;
  type: string;
  typeOptions: { key: string; label: string }[];
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

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {state === "error" && (
        <span className="text-xs text-red-400">Failed</span>
      )}
      <select
        value={type}
        disabled={state === "busy"}
        aria-label="Type"
        onChange={(e) => void patch({ type: e.target.value })}
        className="rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-xs text-neutral-400 outline-none focus:border-neutral-600"
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
        className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-50"
      >
        ✓ Triaged
      </button>
    </span>
  );
}
