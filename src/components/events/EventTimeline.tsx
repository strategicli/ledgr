// The Timeline lens body: the meeting-time timeline (PRD §4.2) — upcoming first
// (soonest at the top), then past (most recent first), then undated at the
// bottom. Extracted verbatim from the retired bespoke /events page so the
// generic /list/event page can render it as a lens. The caller does the one
// fetch and the upcoming/past/undated split (presentation over one query) and
// owns the SelectionProvider / bulk bar / Load-more around this.
import Link from "next/link";
import RowAction from "@/components/home/RowAction";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import { formatWhenShort } from "@/lib/event-format";

// Structural row type: whatever the list query yields, we only touch these.
export type TimelineRow = { id: string; title: string | null; meetingAt: Date | null };

function MeetingRow({ meeting, now, tz }: { meeting: TimelineRow; now: Date; tz: string }) {
  const when = formatWhenShort(meeting.meetingAt, now, tz);
  return (
    <li className="group flex items-start gap-2.5 rounded px-2 py-1.5 hover:bg-neutral-800/60">
      <SelectCheckbox id={meeting.id} />
      <span
        className="w-16 shrink-0 pt-0.5 text-xs leading-tight tabular-nums text-neutral-500"
        title={when.full}
      >
        <span className="block">{when.day}</span>
        {when.time && <span className="block text-neutral-600">{when.time}</span>}
      </span>
      <Link
        href={`/items/${meeting.id}`}
        className={`min-w-0 flex-1 text-sm [overflow-wrap:anywhere] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden ${
          meeting.title ? "text-neutral-200" : "text-neutral-500"
        }`}
      >
        {meeting.title || "Untitled"}
      </Link>
      <RowAction id={meeting.id} action="trash" />
    </li>
  );
}

function Section({
  title,
  rows,
  now,
  tz,
}: {
  title: string;
  rows: TimelineRow[];
  now: Date;
  tz: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </h2>
      <ul className="mt-1">
        {rows.map((m) => (
          <MeetingRow key={m.id} meeting={m} now={now} tz={tz} />
        ))}
      </ul>
    </section>
  );
}

export default function EventTimeline({
  upcoming,
  past,
  undated,
  now,
  tz,
}: {
  upcoming: TimelineRow[];
  past: TimelineRow[];
  undated: TimelineRow[];
  now: Date;
  tz: string;
}) {
  if (upcoming.length === 0 && past.length === 0 && undated.length === 0) {
    return <p className="mt-6 px-2 text-sm text-neutral-600">No events yet.</p>;
  }
  return (
    <>
      <Section title="Upcoming" rows={upcoming} now={now} tz={tz} />
      <Section title="Past" rows={past} now={now} tz={tz} />
      <Section title="No date" rows={undated} now={now} tz={tz} />
    </>
  );
}
