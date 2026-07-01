"use client";

// Meetings widget body (Project Type, Tyler 2026-07-01): the record's contained
// meetings (events) with their dates, and a "+ Meeting" that expands a compact
// title + date box (InlineContainAdd) to add one associated with this project.
// The date lands on meeting_at server-side. Read-only rows link to the meeting.
import Link from "next/link";
import InlineContainAdd from "@/components/canvas/widgets/InlineContainAdd";

type Row = { id: string; title: string; when: string | null };

function dayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  // A date-only meeting is stored at UTC midnight; a timed one carries a real
  // time. Show the time (local) only when there is one.
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  if (dateOnly) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MeetingsWidget({
  recordId,
  items,
}: {
  recordId: string;
  items: Row[];
}) {
  // By date, closest on top (ascending); undated last (Tyler, 2026-07-01).
  const sorted = [...items].sort((a, b) => {
    if (!a.when) return b.when ? 1 : 0;
    if (!b.when) return -1;
    return a.when.localeCompare(b.when);
  });

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 empty:hidden">
        {sorted.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <Link href={`/items/${m.id}`} className="min-w-0 flex-1 truncate text-neutral-200 hover:text-neutral-100">
              {m.title || "Untitled"}
            </Link>
            {dayLabel(m.when) && <span className="shrink-0 text-xs text-neutral-500">{dayLabel(m.when)}</span>}
          </li>
        ))}
      </ul>
      <InlineContainAdd recordId={recordId} type="event" label="Meeting" withTime />
    </div>
  );
}
