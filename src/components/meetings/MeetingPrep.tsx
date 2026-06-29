// Meeting prep panel (slice 24, PRD §5.1), rendered on an event canvas above the
// Linked-here panel. Deterministic assembly: the related people (with their live
// suggestions inline), their open tasks, and the last few meetings with them.
// Server component; one getMeetingPrep call. Each block is a standardized
// CanvasSection so it carries the owner's chosen section weight (the canvas
// redesign). Open tasks reuse the actionable RelatedRow (check off + edit due in
// place). Action-item promotion now lives on the body's `[ ]` lines (block
// anchors, ADR-090), so the old "+ Promote action item to task" button is gone.
import Link from "next/link";
import { getMeetingPrep } from "@/lib/meetings/prep";
import CanvasSection from "@/components/canvas/CanvasSection";
import NavGlyph from "@/components/nav/NavGlyph";
import PinRuleButton from "./PinRuleButton";
import SuggestedPeople from "./SuggestedPeople";
import TaskPullControl from "@/components/events/TaskPullControl";
import PrepTaskList from "./PrepTaskList";

const tsFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// Initials for a person chip's avatar: first + last word, else first two letters.
function initials(title: string): string {
  const parts = (title || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function MeetingPrep({
  ownerId,
  itemId,
  // Rendered as a single grid card (ADR-069): drop the per-section card chrome
  // and centered column so the three blocks stack inside the one grid card.
  bare = false,
}: {
  ownerId: string;
  itemId: string;
  bare?: boolean;
}) {
  const prep = await getMeetingPrep(ownerId, itemId);

  const templateChip = prep.templateName ? (
    prep.templatePrototypeId ? (
      <Link
        href={`/items/${prep.templatePrototypeId}`}
        title="Edit or unpin this rule's template"
        className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-normal normal-case tracking-normal text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
      >
        from rule: {prep.templateName}
      </Link>
    ) : (
      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-normal normal-case tracking-normal text-neutral-400">
        from rule: {prep.templateName}
      </span>
    )
  ) : null;

  return (
    <>
      <CanvasSection
        bare={bare}
        icon="people"
        title="People"
        count={prep.people.length}
        action={
          (templateChip || (prep.people.length > 0 && !prep.templateName)) && (
            <div className="flex flex-wrap items-center gap-2">
              {templateChip}
              {/* Offer to pin a standing rule once people are confirmed, unless
                  this event already came from one. */}
              {prep.people.length > 0 && !prep.templateName && (
                <PinRuleButton eventId={itemId} />
              )}
            </div>
          )
        }
      >
        {prep.people.length === 0 && prep.suggestedPeople.length === 0 ? (
          <p className="px-1 text-sm text-neutral-600">
            No one matched this event yet. Relate a person below, or set a tag to
            pull its tasks.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {prep.people.map((e) => (
              <Link
                key={e.id}
                href={`/items/${e.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-800/60 py-0.5 pl-1 pr-2.5 text-sm text-neutral-200 hover:border-neutral-600"
              >
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-neutral-700 text-[10px] text-neutral-100">
                  {initials(e.title)}
                </span>
                {e.title || "Untitled"}
              </Link>
            ))}
            {/* Live guesses (any event), inline with the confirmed people; a
                one-click add → confirmed relation. */}
            <SuggestedPeople eventId={itemId} people={prep.suggestedPeople} />
          </div>
        )}
      </CanvasSection>

      {/* Open tasks: always shown — its pull rule can reference tags, not just
          the event's people (ADR-094 E4). Rows reuse RelatedRow so they check
          off and edit their due date in place. */}
      <CanvasSection bare={bare} icon="tasks" title="Open tasks" count={prep.openTasks.length}>
        <TaskPullControl
          eventId={itemId}
          rule={prep.taskPull}
          seeds={prep.taskPullSeeds}
          peopleCount={prep.people.length}
        />
        <PrepTaskList
          hostId={itemId}
          tasks={prep.openTasks.map((t) => ({
            id: t.id,
            type: t.type,
            title: t.title ?? "",
            status: t.status,
            statusCategory: t.statusCategory,
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
            updatedAt: t.updatedAt.toISOString(),
          }))}
        />
      </CanvasSection>

      {prep.people.length > 0 && (
        <CanvasSection bare={bare} icon="recent" title="Recent meetings">
          {prep.recentMeetings.length === 0 ? (
            <p className="px-1 text-sm text-neutral-600">None yet.</p>
          ) : (
            <ul className="canvas-rows">
              {prep.recentMeetings.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-800/50"
                >
                  <NavGlyph icon="meetings" size={14} className="shrink-0 text-neutral-600" />
                  <Link
                    href={`/items/${m.id}`}
                    className="min-w-0 flex-1 truncate text-neutral-200 hover:underline"
                  >
                    {m.title || "Untitled"}
                  </Link>
                  {m.meetingAt && (
                    <span className="shrink-0 text-xs text-neutral-500">
                      {tsFmt.format(m.meetingAt)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CanvasSection>
      )}
    </>
  );
}
