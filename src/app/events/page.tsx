// Meetings list as a timeline (PRD §4.2): upcoming first (soonest at the
// top), then past (most recent first), undated parked at the bottom. One
// query; the upcoming/past split is presentation, not a second fetch.
import Link from "next/link";
import { redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import LoadMore from "@/components/lists/LoadMore";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectionProvider from "@/components/selection/SelectionProvider";
import { bulkConfigForType } from "@/lib/bulk-config";
import { resolveOwner } from "@/lib/owner";
import { APP_TIMEZONE } from "@/lib/today";
import { getType } from "@/lib/types";
import { countViewItems, parseListWindow, queryViewItems } from "@/lib/views";
import { listCalendarFeed, type FeedEvent } from "@/lib/calendar/feed";
import AddEventButton from "@/components/calendar/AddEventButton";

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
      <SelectCheckbox id={meeting.id} />
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

// The calendar feed (ADR-094 E3): upcoming calendar events not yet pulled into
// Ledgr. Matched events auto-promote on sync (they show in the lists below);
// these are the rest, each a one-click Add.
function CalendarFeedSection({ events, now }: { events: FeedEvent[]; now: Date }) {
  if (events.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        From your calendar
        <span className="rounded-full bg-neutral-800 px-1.5 text-[11px] font-normal normal-case text-neutral-400">
          {events.length}
        </span>
      </h2>
      <p className="mt-1 px-2 text-xs text-neutral-600">
        Upcoming calendar events not yet in Ledgr. Add the ones you want to track.
      </p>
      <ul className="mt-1">
        {events.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
          >
            <span className="w-40 shrink-0 text-xs tabular-nums text-neutral-500">
              {e.startAt ? formatWhen(e.startAt, now) : ""}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                e.title ? "text-neutral-300" : "text-neutral-500"
              }`}
            >
              {e.title || "Untitled"}
              {e.attendeeCount > 0 && (
                <span className="ml-1.5 text-xs text-neutral-600">
                  · {e.attendeeCount} {e.attendeeCount === 1 ? "person" : "people"}
                </span>
              )}
            </span>
            <AddEventButton cacheId={e.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function Meetings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const sp = await searchParams;
  const now = new Date();
  // A window of events (Load-more grows it, oldest-past first to fall off the
  // bottom) plus the true total, so the subtitle counts every event, not the
  // window. The upcoming/past/undated split is presentation over this one fetch.
  const show = parseListWindow(sp.show);
  const filter = { type: "event" };
  const [meetings, total, feed] = await Promise.all([
    queryViewItems(owner.id, filter, { field: "meetingAt", dir: "desc" }, show),
    countViewItems(owner.id, filter),
    listCalendarFeed(owner.id, { now }),
  ]);
  const upcoming = meetings
    .filter((m) => m.meetingAt != null && m.meetingAt >= now)
    .reverse(); // desc fetch -> soonest first
  const past = meetings.filter((m) => m.meetingAt != null && m.meetingAt < now);
  const undated = meetings.filter((m) => m.meetingAt == null);

  return (
    <ListPage
      tab="events"
      title="Events"
      subtitle={`${total} event${total === 1 ? "" : "s"}`}
      actions={<NewItemButton type="event" />}
    >
      <CalendarFeedSection events={feed} now={now} />
      {meetings.length === 0 && feed.length === 0 && (
        <p className="mt-6 px-2 text-sm text-neutral-600">No events yet.</p>
      )}
      <SelectionProvider ids={[...upcoming, ...past, ...undated].map((m) => m.id)}>
        <Section title="Upcoming" rows={upcoming} now={now} />
        <Section title="Past" rows={past} now={now} />
        <Section title="No date" rows={undated} now={now} />
        <LoadMore shown={meetings.length} total={total} basePath="/events" params={sp} />
        <BulkActionBar {...bulkConfigForType(await getType("event"))} />
      </SelectionProvider>
    </ListPage>
  );
}
