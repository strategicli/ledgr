// The Calendar lens body (ADR-094 E3, generalized to a lens): upcoming calendar
// events not yet pulled into Ledgr, each a one-click Add. Matched events
// auto-promote on sync and show under the Timeline lens instead; these are the
// rest. Extracted from the retired bespoke /events page so the generic
// /list/event page can render it as the default "Calendar" tab.
import { formatWhen } from "@/lib/event-format";
import type { FeedEvent } from "@/lib/calendar/feed";
import AddEventButton from "@/components/calendar/AddEventButton";

export default function CalendarFeed({
  events,
  now,
}: {
  events: FeedEvent[];
  now: Date;
}) {
  if (events.length === 0) {
    return (
      <p className="mt-6 px-2 text-sm text-neutral-600">
        No upcoming calendar events to add. New meetings on your calendar show up
        here to pull into Ledgr.
      </p>
    );
  }
  return (
    <section className="mt-4">
      <p className="px-2 text-xs text-neutral-500">
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
