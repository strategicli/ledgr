// Meeting prep panel (slice 24, PRD §5.1; people model unified by ADR-144),
// rendered on an event canvas above the Linked-here panel. Deterministic
// assembly: the People card (group + attendance strata, ONE place to manage
// everyone), the rule-pulled open tasks behind plain-language lens presets, and
// the recent meetings in the same context. Server component; one getMeetingPrep
// call. Each block is a standardized CanvasSection so it carries the owner's
// chosen section weight (the canvas redesign). Open tasks reuse the actionable
// RelatedRow (check off + edit due in place). Action-item promotion lives on
// the body's `[ ]` lines (block anchors, ADR-090).
import Link from "next/link";
import { getMeetingPrep } from "@/lib/meetings/prep";
import { resolveProvidedGroup } from "@/lib/related-views";
import { bulkConfigForType } from "@/lib/bulk-config";
import { defaultLenses, lensesForType, relatedLensFor } from "@/lib/list-lenses";
import { getSettings } from "@/lib/settings";
import { DEFAULT_TIMEZONE } from "@/lib/today";
import { getType } from "@/lib/types";
import CanvasSection from "@/components/canvas/CanvasSection";
import ViewLensBody from "@/components/lists/ViewLensBody";
import NavGlyph from "@/components/nav/NavGlyph";
import PinRuleButton from "./PinRuleButton";
import RelatedLensPicker from "@/components/relations/RelatedLensPicker";
import EventPeopleCard from "@/components/events/EventPeopleCard";
import TaskPullPresets from "@/components/events/TaskPullPresets";

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

  // "Open tasks" is rule-pulled (ADR-094 E4), so it renders through the same lens
  // machinery as "Linked here" — the task type's SORT lenses (a view lens's filter
  // can't apply to a rule-chosen set) + ViewRenderer + the multi-select layer
  // (ADR-118). The lens choice shares the (event:task) key with the Linked-here
  // task group, so "how I view this meeting's tasks" stays one setting.
  const settings = await getSettings(ownerId);
  // meeting_at is a real instant; render it in the owner's timezone (the server
  // clock is UTC, so an unqualified formatter would be wrong).
  const tz = settings.timezone ?? DEFAULT_TIMEZONE;
  const tsFmt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
  });
  const dayFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz });
  const taskSortLenses = lensesForType(settings, "task").filter((l) => l.kind === "sort");
  const chosenTaskLens = relatedLensFor(settings, "event", "task");
  const taskLens =
    chosenTaskLens.kind === "sort" ? chosenTaskLens : taskSortLenses[0] ?? defaultLenses()[0];
  const [openTaskData, taskTypeDef] = await Promise.all([
    resolveProvidedGroup(prep.openTasks, "task", taskLens, true),
    getType("task").catch(() => null),
  ]);
  const taskBulkConfig = taskTypeDef ? bulkConfigForType(taskTypeDef) : undefined;

  const templateChip = prep.templateName ? (
    prep.templatePrototypeId ? (
      <Link
        href={`/items/${prep.templatePrototypeId}`}
        title={`from rule: ${prep.templateName} — edit or unpin this rule's template`}
        className="inline-block max-w-[11rem] truncate rounded bg-neutral-800 px-1.5 py-0.5 align-bottom text-xs font-normal normal-case tracking-normal text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
      >
        from rule: {prep.templateName}
      </Link>
    ) : (
      <span
        title={`from rule: ${prep.templateName}`}
        className="inline-block max-w-[11rem] truncate rounded bg-neutral-800 px-1.5 py-0.5 align-bottom text-xs font-normal normal-case tracking-normal text-neutral-400"
      >
        from rule: {prep.templateName}
      </span>
    )
  ) : null;

  const hasPeople = prep.attending.length > 0 || prep.groups.length > 0;

  return (
    <>
      <CanvasSection
        bare={bare}
        icon="people"
        title="People"
        count={prep.attending.length}
        action={
          (templateChip || (hasPeople && !prep.templateName)) && (
            <div className="flex flex-wrap items-center gap-2">
              {templateChip}
              {/* Offer to pin a standing rule once people are confirmed, unless
                  this event already came from one. */}
              {hasPeople && !prep.templateName && <PinRuleButton eventId={itemId} />}
            </div>
          )
        }
      >
        <EventPeopleCard
          eventId={itemId}
          groups={prep.groups}
          attending={prep.attending}
          absent={prep.absent}
          ghosts={prep.ghosts}
          mentioned={prep.mentioned}
        />
      </CanvasSection>

      {/* Catch up (ADR-144 Phase 3): the recent meetings the people HERE were
          marked OUT of — so a 1:1's prep flags what they missed, each meeting a
          click away (its agenda / notes / tasks). Auto-hides when no one here
          has a recent absence. */}
      {prep.missedMeetings.length > 0 && (
        <CanvasSection bare={bare} icon="flag-goal" title="Catch up on what they missed">
          <ul className="canvas-rows">
            {prep.missedMeetings.map((m) => (
              <li
                key={`${m.personId}:${m.meetingId}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-800/50"
              >
                <span className="shrink-0 text-neutral-300">{m.personTitle || "Someone"}</span>
                <span className="shrink-0 text-neutral-600">missed</span>
                <Link
                  href={`/items/${m.meetingId}`}
                  className="min-w-0 flex-1 truncate text-neutral-200 hover:underline"
                >
                  {m.meetingTitle || "Untitled"}
                </Link>
                {m.meetingAt && (
                  <span className="shrink-0 text-xs text-neutral-500">
                    {dayFmt.format(m.meetingAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CanvasSection>
      )}

      {/* Open tasks: always shown — its pull rule can reference groups and tags,
          not just the event's people (ADR-094 E4 / ADR-144). Rows reuse
          RelatedRow so they check off and edit their due date in place. */}
      <CanvasSection
        bare={bare}
        icon="tasks"
        title="Open tasks"
        count={openTaskData.count}
        action={
          taskSortLenses.length > 1 ? (
            <RelatedLensPicker
              hostType="event"
              relatedType="task"
              lenses={taskSortLenses}
              currentId={taskLens.id}
            />
          ) : undefined
        }
      >
        <TaskPullPresets
          eventId={itemId}
          preset={prep.pullPreset}
          groupNames={prep.groups.map((g) => g.title || "Untitled")}
          rule={prep.taskPull}
          seeds={prep.taskPullSeeds}
          peopleCount={prep.attending.length}
        />
        {prep.openTasks.length === 0 ? (
          <p className="px-1 pt-1 text-sm text-neutral-600">No open tasks match.</p>
        ) : (
          <ViewLensBody data={openTaskData} bulkConfig={taskBulkConfig} />
        )}
      </CanvasSection>

      {hasPeople && (
        <CanvasSection
          bare={bare}
          icon="recent"
          title={
            prep.groups.length > 0
              ? `Past ${prep.groups.map((g) => g.title || "Untitled").join(" + ")} meetings`
              : "Recent meetings"
          }
        >
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
