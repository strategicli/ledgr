"use client";

// Milestones widget body (Project Type): the record's key dates. A milestone has
// NO done-state — it arrives whether you act or not (PRD §6), so each row's
// "upcoming"/"passed" is DERIVED from its date vs today, never a checkbox. Adding
// is a "+ Milestone" that expands a compact title + date box (InlineContainAdd),
// Add/Cancel or Enter (Tyler, 2026-07-01).
import Link from "next/link";
import InlineContainAdd from "@/components/canvas/widgets/InlineContainAdd";

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
  // By date, closest on top (ascending); undated last (Tyler, 2026-07-01).
  const sorted = [...items].sort((a, b) => {
    if (!a.dueDate) return b.dueDate ? 1 : 0;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 empty:hidden">
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
      <InlineContainAdd recordId={recordId} type="milestone" label="Milestone" />
    </div>
  );
}
