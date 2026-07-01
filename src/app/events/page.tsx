// The events surface unified onto the generic /list/event page (ADR-094 follow-
// up): the calendar feed and the meeting-time timeline are now lenses there
// (Calendar / Timeline), alongside the generic sorts. This route is kept as a
// redirect so old bookmarks and links still land on events.
import { redirect } from "next/navigation";

export default function Events() {
  redirect("/list/event");
}
