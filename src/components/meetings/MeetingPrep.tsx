// Meeting prep panel (slice 24, PRD §5.1), rendered on a meeting canvas above
// the backlinks panel. Deterministic assembly: the related people, their open
// tasks, the last few meetings with them, and the action-item -> task
// promotion. Server component; one getMeetingPrep call.
import Link from "next/link";
import { getMeetingPrep } from "@/lib/meetings/prep";
import SectionHeading from "@/components/canvas/SectionHeading";
import PromoteTask from "./PromoteTask";
import PinRuleButton from "./PinRuleButton";
import SuggestedPeople from "./SuggestedPeople";
import TaskPullControl from "@/components/events/TaskPullControl";

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const tsFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function MeetingPrep({
  ownerId,
  itemId,
}: {
  ownerId: string;
  itemId: string;
}) {
  const prep = await getMeetingPrep(ownerId, itemId);

  return (
    <section className="mx-auto w-full max-w-3xl px-2 pt-4 sm:px-8 md:px-12">
      <div className="flex flex-wrap items-center gap-2">
        <SectionHeading icon="people">People</SectionHeading>
        {prep.templateName &&
          (prep.templatePrototypeId ? (
            <Link
              href={`/items/${prep.templatePrototypeId}`}
              title="Edit or unpin this rule's template"
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
            >
              auto-filled from rule: {prep.templateName}
            </Link>
          ) : (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
              auto-filled from rule: {prep.templateName}
            </span>
          ))}
        {/* Offer to pin a standing rule once people are confirmed, unless this
            event already came from one (templateName set). */}
        {prep.people.length > 0 && !prep.templateName && <PinRuleButton eventId={itemId} />}
      </div>

      {prep.people.length === 0 ? (
        <p className="mt-2 px-2 text-sm text-neutral-600">
          {prep.suggestedPeople.length > 0
            ? "No one confirmed yet — add a suggestion below, or relate a person."
            : "No one matched this event. Relate a person below, or set a tag to pull its tasks."}
        </p>
      ) : (
        <div className="mt-2 px-2 text-sm text-neutral-400">
          {prep.people.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <Link href={`/items/${e.id}`} className="text-neutral-300 hover:underline">
                {e.title || "Untitled"}
              </Link>
            </span>
          ))}
        </div>
      )}

      {/* Live guesses (any event), one-click add → confirmed relation. */}
      <SuggestedPeople eventId={itemId} people={prep.suggestedPeople} />

      {/* Open tasks: always shown — its pull rule can reference tags, not just
          the event's people (ADR-094 E4). */}
      <div className="mt-4">
        <SectionHeading icon="tasks">Open tasks ({prep.openTasks.length})</SectionHeading>
        <div className="mt-1">
          <TaskPullControl
            eventId={itemId}
            rule={prep.taskPull}
            seeds={prep.taskPullSeeds}
            peopleCount={prep.people.length}
          />
          {prep.openTasks.length === 0 ? (
            <p className="px-2 text-sm text-neutral-600">No open tasks match.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {prep.openTasks.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2 px-2 text-sm">
                  <Link href={`/items/${t.id}`} className="text-neutral-300 hover:underline">
                    {t.title || "Untitled"}
                  </Link>
                  {t.dueDate && (
                    <span className="text-xs text-neutral-600">
                      due {dateFmt.format(t.dueDate)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {prep.people.length > 0 && (
        <div className="mt-4">
          <SectionHeading icon="recent">Recent meetings</SectionHeading>
          {prep.recentMeetings.length === 0 ? (
            <p className="mt-1 px-2 text-sm text-neutral-600">None yet.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {prep.recentMeetings.map((m) => (
                <li key={m.id} className="flex items-baseline gap-2 px-2 text-sm">
                  <Link href={`/items/${m.id}`} className="text-neutral-300 hover:underline">
                    {m.title || "Untitled"}
                  </Link>
                  {m.meetingAt && (
                    <span className="text-xs text-neutral-600">
                      {tsFmt.format(m.meetingAt)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3">
        <PromoteTask meetingId={itemId} />
      </div>
    </section>
  );
}
