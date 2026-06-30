"use client";

// Milestones widget body (Project Type, ADR-111/PJ5): the record's key dates.
// A milestone has NO done-state — it arrives whether you act or not (PRD §6), so
// each row's "upcoming"/"passed" is DERIVED here from its date vs today, never a
// checkbox. Add files a milestone contained by the record (date = due_date).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Row = { id: string; title: string; dueDate: string | null };

function dayLabel(iso: string | null): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Passed if the date is strictly before today's UTC calendar day.
function isPassed(iso: string | null): boolean {
  if (!iso) return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(iso).getTime() < todayUtc;
}

export default function MilestonesWidget({
  recordId,
  items,
}: {
  recordId: string;
  items: Row[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const t = label.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${recordId}/contain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "milestone", title: t, date: date || undefined }),
      });
      if (res.ok) {
        setLabel("");
        setDate("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...items].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {sorted.length === 0 && <li className="text-sm text-neutral-500">No milestones yet.</li>}
        {sorted.map((m) => {
          const passed = isPassed(m.dueDate);
          return (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${passed ? "bg-neutral-800 text-neutral-500" : "bg-amber-950/50 text-amber-300"}`}>
                {passed ? "passed" : "upcoming"}
              </span>
              <Link href={`/items/${m.id}`} className="min-w-0 flex-1 truncate text-neutral-200 hover:text-neutral-100">
                {m.title || "Untitled"}
              </Link>
              <span className="shrink-0 text-xs text-neutral-500">{dayLabel(m.dueDate)}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-1">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="+ Milestone"
          disabled={busy}
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-transparent px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={busy}
          className="shrink-0 rounded border border-neutral-800 bg-transparent px-1 py-1 text-xs text-neutral-300 focus:border-neutral-600 focus:outline-none"
        />
      </div>
    </div>
  );
}
