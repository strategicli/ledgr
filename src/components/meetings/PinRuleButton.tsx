// "Pin as rule" (EM4, ADR-123): turn this event's confirmed people into a
// standing rule routed through an `event` template, so future matching events
// auto-fill the same people (and any content the owner later adds to the
// template). POSTs to /api/events/[id]/pin-rule (condition derived server-side
// from the event's attendee/series/title). A labeled control + hover tooltip
// (the CLAUDE.md "explain every bespoke control" + CSS-tooltip conventions).
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PinRuleButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function pin() {
    setState("saving");
    try {
      const res = await fetch(`/api/events/${eventId}/pin-rule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { created: boolean };
      setState("done");
      setMsg(
        data.created
          ? "Pinned — future matching events auto-fill these people."
          : "Rule updated with these people."
      );
      router.refresh();
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return <span className="text-xs text-emerald-500">✓ {msg}</span>;
  }

  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        onClick={pin}
        disabled={state === "saving"}
        className="cursor-help rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400 underline decoration-dotted decoration-neutral-600 underline-offset-2 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50"
      >
        {state === "saving" ? "Pinning…" : "Pin as rule"}
      </button>
      {state === "error" && <span className="ml-2 text-xs text-red-400">failed</span>}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-64 rounded border border-neutral-700 bg-neutral-900 p-2 text-xs normal-case leading-snug text-neutral-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      >
        Save these people as an ongoing rule for events like this one. It creates
        an event template (with these people pre-related) that future matching
        events apply automatically. You can add recurring content to the template
        afterward.
      </span>
    </span>
  );
}
