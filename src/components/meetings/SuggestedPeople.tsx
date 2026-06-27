// Live person suggestions on the event canvas (ADR-123). Renders the guesses
// getMeetingPrep computed (attendee email + fuzzy title, owner-excluded) as
// dashed "sparkle" chips that sit INLINE with the confirmed people (the canvas
// redesign), so suggestions read as faint, not-yet-confirmed peers rather than a
// separate row. A one-click add relates the person as a CONFIRMED edge
// (POST /api/items/[eventId]/relations), so it flows straight into prep/task-pull.
// Each added person disappears optimistically; a refresh re-pulls prep so the new
// person shows as a solid chip under People. Returns a fragment (no wrapper) so
// it composes into the People chip row.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Suggested = { id: string; title: string };

export default function SuggestedPeople({
  eventId,
  people,
}: {
  eventId: string;
  people: Suggested[];
}) {
  const router = useRouter();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = people.filter((p) => !added.has(p.id));
  if (remaining.length === 0) return null;

  async function add(personId: string) {
    setBusy(personId);
    setError(null);
    try {
      const res = await fetch(`/api/items/${eventId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: personId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAdded((prev) => new Set(prev).add(personId));
      router.refresh();
    } catch {
      setError(personId);
    }
    setBusy(null);
  }

  return (
    <>
      {remaining.map((p) => (
        <span key={p.id} className="group/sug relative inline-flex">
          <button
            type="button"
            onClick={() => add(p.id)}
            disabled={busy === p.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-neutral-700 py-0.5 pl-2 pr-2.5 text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 disabled:opacity-50"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="shrink-0 text-[var(--accent)]"
            >
              <path d="M12 2l1.7 5.6L19 9l-5.3 1.4L12 16l-1.7-5.6L5 9l5.3-1.4z" />
            </svg>
            {p.title || "Untitled"}
            {error === p.id && <span className="ml-1 text-xs text-red-400">failed</span>}
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-200 opacity-0 shadow-lg transition-opacity group-hover/sug:opacity-100"
          >
            Suggested · click to confirm
          </span>
        </span>
      ))}
    </>
  );
}
