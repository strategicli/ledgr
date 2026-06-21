// Bespoke task canvas (Tasks redesign): a focused two-pane view for a task —
// left = parent breadcrumb + title + description + central subtasks; right rail
// = the task's fields (status/scheduled/due/priority), repeat, reminder/focus,
// and its relation fields (Project, Tags) + custom scalars. Composes the same
// proven panels the default canvas uses, just laid out as two panes. Registered
// for the `task` type via the canvas seam (ADR-041); falls back gracefully.
import type { ReactNode } from "react";
import Link from "next/link";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import FieldStrip, { type StripValues } from "@/components/canvas/FieldStrip";
import Subtasks from "@/components/subtasks/Subtasks";
import RelationProperties from "@/components/relations/RelationProperties";
import CustomProperties from "@/components/build/CustomProperties";
import RecurrenceControl from "@/components/canvas/RecurrenceControl";
import RecurrenceCalendar from "@/components/canvas/RecurrenceCalendar";
import ReminderControl from "@/components/canvas/ReminderControl";
import ScheduledTimeControl from "@/components/canvas/ScheduledTimeControl";
import FocusStar from "@/components/today/FocusStar";
import RelatedPanel from "@/components/relations/RelatedPanel";
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import HistoryPanel from "@/components/canvas/HistoryPanel";
import { topStripFields } from "@/lib/canvas-fields";
import { getType } from "@/lib/types";
import { getItem } from "@/lib/items";
import { resolveStatusSchema } from "@/lib/status";
import { parseRecurrence } from "@/lib/recurrence";
import { appTodayYmd } from "@/lib/recurrence-service";
import { parseScheduledTime } from "@/lib/scheduled-time";
import { isFocusedOn } from "@/lib/focus";
import { bodyMarkdown } from "@/lib/body";
import type { CanvasProps } from "@/lib/modules";

export default async function TaskCanvas({ item, ownerId }: CanvasProps) {
  const typeDef = await getType("task").catch(() => null);
  const propertySchema = typeDef?.propertySchema ?? [];
  const statuses = resolveStatusSchema(typeDef?.statusSchema ?? null);
  const today = appTodayYmd();
  const props = (item.properties as Record<string, unknown>) ?? {};

  const strip: StripValues = {
    status: item.status,
    dueDate: item.dueDate?.toISOString() ?? null,
    scheduledDate: item.scheduledDate?.toISOString() ?? null,
    urgency: item.urgency,
    meetingAt: item.meetingAt?.toISOString() ?? null,
    url: item.url,
  };
  const recurrenceRule = parseRecurrence(props.recurrence);
  const reminderObj = props.reminder as Record<string, unknown> | undefined;
  const reminderMinutes =
    typeof reminderObj?.minutesBefore === "number" ? reminderObj.minutesBefore : null;
  const scheduledTime = parseScheduledTime(item.properties);
  const hasSchedule = item.scheduledDate != null || recurrenceRule != null;

  const relationFields = propertySchema.filter((p) => p.kind === "relation");
  const scalarFields = propertySchema.filter((p) => p.kind !== "relation");

  // Parent breadcrumb (a subtask points up to its parent task).
  const parent = item.parentId ? await getItem(ownerId, item.parentId).catch(() => null) : null;
  const parentLink =
    parent && !parent.deletedAt ? { href: `/items/${parent.id}`, title: parent.title || "Untitled" } : null;

  const railHeading = (label: string): ReactNode => (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</h3>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 md:px-10">
      {parentLink && (
        <Link
          href={parentLink.href}
          className="mb-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
        >
          ↑ <span className="max-w-[20rem] truncate">{parentLink.title}</span>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Left: title · description · subtasks */}
        <div className="min-w-0">
          <ItemEditor item={{ id: item.id, title: item.title, body: item.body }} slot="title" />
          <div className="mt-3">
            <ItemEditor item={{ id: item.id, title: item.title, body: item.body }} slot="body" />
          </div>
          <div className="mt-4">
            <Subtasks ownerId={ownerId} itemId={item.id} parentScheduled={item.scheduledDate ?? null} />
          </div>
        </div>

        {/* Right rail: the task's details */}
        <aside className="flex flex-col gap-4 lg:border-l lg:border-neutral-800 lg:pl-6">
          <div>
            {railHeading("Details")}
            <div className="mt-2">
              <FieldStrip
                itemId={item.id}
                fields={topStripFields("task")}
                initial={strip}
                today={today}
                statuses={statuses}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-500">
            <span className="flex items-center gap-1.5">
              <FocusStar itemId={item.id} focused={isFocusedOn(item.properties, today)} today={today} />
              Focus today
            </span>
            <ScheduledTimeControl itemId={item.id} initial={scheduledTime} hasSchedule={hasSchedule} />
            <ReminderControl itemId={item.id} initialMinutes={reminderMinutes} />
          </div>
          <RecurrenceControl
            itemId={item.id}
            initial={recurrenceRule}
            scheduledDate={item.scheduledDate?.toISOString() ?? null}
            dueDate={item.dueDate?.toISOString() ?? null}
            today={today}
          />
          {recurrenceRule && recurrenceRule.occurrenceMode === "virtual" && (
            <RecurrenceCalendar itemId={item.id} initial={recurrenceRule} today={today} />
          )}
          {relationFields.length > 0 && (
            <RelationProperties ownerId={ownerId} itemId={item.id} typeKey="task" props={relationFields} />
          )}
          {scalarFields.length > 0 && (
            <CustomProperties
              itemId={item.id}
              typeKey="task"
              schema={scalarFields}
              initial={props}
            />
          )}
        </aside>
      </div>

      <RelatedPanel ownerId={ownerId} itemId={item.id} />
      <SaveOffline itemId={item.id} />
      <ShareLink itemId={item.id} />
      <HistoryPanel itemId={item.id} currentText={bodyMarkdown(item.body)} />
    </div>
  );
}
