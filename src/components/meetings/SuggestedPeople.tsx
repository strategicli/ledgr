// Live person suggestions on the event canvas (ADR-123). Renders the guesses
// getMeetingPrep computed (attendee email + fuzzy title, owner-excluded) with a
// one-click "+ add" that relates the person to the event as a CONFIRMED edge
// (POST /api/items/[eventId]/relations), so it flows straight into prep/task-pull.
// Each added person disappears from the list optimistically; a refresh re-pulls
// prep so the new person shows under People.
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
    } finally {
      setBusy(null);
    }
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 px-2 text-xs text-neutral-500">
      <span className="text-neutral-600">Suggested:</span>
      {remaining.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => add(p.id)}
          disabled={busy === p.id}
          title="Add this person to the event"
          className="inline-flex items-center gap-1 rounded border border-dashed border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800/60 disabled:opacity-50"
        >
          <span className="text-neutral-500">+</span>
          {p.title || "Untitled"}
          {error === p.id && <span className="ml-1 text-red-400">failed</span>}
        </button>
      ))}
    </p>
  );
}
