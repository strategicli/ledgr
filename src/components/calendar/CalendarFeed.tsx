// The Calendar lens body (ADR-094 E3, generalized to a lens): upcoming calendar
// events not yet pulled into Ledgr, each a one-click Add. Matched events
// auto-promote on sync and show under the Timeline lens instead; these are the
// rest. Extracted from the retired bespoke /events page so the generic
// /list/event page can render it as the default "Calendar" tab.
import { formatWhenShort } from "@/lib/event-format";
import type { FeedEvent } from "@/lib/calendar/feed";
import AddEventButton from "@/components/calendar/AddEventButton";

export default function CalendarFeed({
  events,
  now,
  tz,
}: {
  events: FeedEvent[];
  now: Date;
  tz: string;
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
        {events.map((e) => {
          const when = formatWhenShort(e.startAt, now, tz);
          return (
            <li
              key={e.id}
              className="flex items-start gap-2.5 rounded px-2 py-1.5 hover:bg-neutral-800/60"
            >
              <span
                className="w-16 shrink-0 pt-0.5 text-xs leading-tight tabular-nums text-neutral-500"
                title={when.full}
              >
                <span className="block">{when.day}</span>
                {when.time && <span className="block text-neutral-600">{when.time}</span>}
              </span>
              <span
                className={`min-w-0 flex-1 text-sm [overflow-wrap:anywhere] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden ${
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
          );
        })}
      </ul>
    </section>
  );
}
