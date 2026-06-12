// Meetings list as a timeline (PRD §4.2): upcoming first (soonest at the
// top), then past (most recent first), undated parked at the bottom. One
// query; the upcoming/past split is presentation, not a second fetch.
import Link from "next/link";
import { redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { resolveOwner } from "@/lib/owner";
import { APP_TIMEZONE } from "@/lib/today";
import { queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

type ListedItem = Awaited<ReturnType<typeof queryViewItems>>[number];

const sameYearFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});
const otherYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});
const yearFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: APP_TIMEZONE,
});

function formatWhen(at: Date, now: Date) {
  return yearFmt.format(at) === yearFmt.format(now)
    ? sameYearFmt.format(at)
    : otherYearFmt.format(at);
}

function MeetingRow({ meeting, now }: { meeting: ListedItem; now: Date }) {
  return (
    <li className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60">
      <span className="w-40 shrink-0 text-xs tabular-nums text-neutral-500">
        {meeting.meetingAt ? formatWhen(meeting.meetingAt, now) : ""}
      </span>
      <Link
        href={`/items/${meeting.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${
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
}: {
  title: string;
  rows: ListedItem[];
  now: Date;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </h2>
      <ul className="mt-1">
        {rows.map((m) => (
          <MeetingRow key={m.id} meeting={m} now={now} />
        ))}
      </ul>
    </section>
  );
}

export default async function Meetings() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const meetings = await queryViewItems(
    owner.id,
    { type: "meeting" },
    { field: "meetingAt", dir: "desc" }
  );
  const now = new Date();
  const upcoming = meetings
    .filter((m) => m.meetingAt != null && m.meetingAt >= now)
    .reverse(); // desc fetch -> soonest first
  const past = meetings.filter((m) => m.meetingAt != null && m.meetingAt < now);
  const undated = meetings.filter((m) => m.meetingAt == null);

  return (
    <ListPage
      tab="meetings"
      title="Meetings"
      subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`}
      actions={<NewItemButton type="meeting" />}
    >
      {meetings.length === 0 && (
        <p className="mt-6 px-2 text-sm text-neutral-600">No meetings yet.</p>
      )}
      <Section title="Upcoming" rows={upcoming} now={now} />
      <Section title="Past" rows={past} now={now} />
      <Section title="No date" rows={undated} now={now} />
    </ListPage>
  );
}
