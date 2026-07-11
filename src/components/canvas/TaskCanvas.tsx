// Bespoke task canvas (Tasks redesign): a focused two-pane view for a task —
// left = parent breadcrumb + title + description + central subtasks; right rail
// = the task's fields (status/scheduled/due/priority), repeat, reminder/focus,
// and its relation fields (Project, Tags) + custom scalars. Composes the same
// proven panels the default canvas uses, just laid out as two panes. Registered
// for the `task` type via the canvas seam (ADR-041); falls back gracefully.
import Link from "next/link";
import MarkdownCanvas from "@/components/canvas/MarkdownCanvas";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import Subtasks from "@/components/subtasks/Subtasks";
import TaskTitle from "@/components/canvas/TaskTitle";
import RelationProperties from "@/components/relations/RelationProperties";
import CustomProperties from "@/components/build/CustomProperties";
import CanvasSection from "@/components/canvas/CanvasSection";
import CanvasTwoPane from "@/components/canvas/CanvasTwoPane";
import SchedulePopover from "@/components/canvas/rail/SchedulePopover";
import DueRow from "@/components/canvas/rail/DueRow";
import PriorityRow from "@/components/canvas/rail/PriorityRow";
import StatusRow from "@/components/canvas/rail/StatusRow";
import { RAIL_ROW, RAIL_STATIC } from "@/components/canvas/rail/styles";
import FocusStar from "@/components/today/FocusStar";
import RelatedPanel from "@/components/relations/RelatedPanel";
import ItemUtilitiesFooter from "@/components/canvas/ItemUtilitiesFooter";
import { getType } from "@/lib/types";
import { getItem } from "@/lib/items";
import { resolveStatusSchema } from "@/lib/status";
import { parseRecurrence } from "@/lib/recurrence";
import { appTodayYmd } from "@/lib/recurrence-service";
import { parseScheduledTime } from "@/lib/scheduled-time";
import { isFocusedOn } from "@/lib/focus";
import { bodyMarkdown } from "@/lib/body";
import type { CanvasProps } from "@/lib/modules";

export default async function TaskCanvas(canvasProps: CanvasProps) {
  const { item, ownerId, arrange = false } = canvasProps;
  const typeDef = await getType("task").catch(() => null);
  // Per-type layout (ADR-069): a saved custom layout — or arrange mode
  // (?arrange=1) — renders the field-level draggable grid every other type gets
  // (the "Customize layout" path, which regressed when ADR-108 moved tasks onto
  // this bespoke rail). The bespoke rail renders in both the full page and the
  // modal — CanvasTwoPane splits on container width, stacking when narrow. Tasks
  // are collapse-only (resizable={false}), so no inner resizer clashes with the
  // modal's own.
  if (arrange || typeDef?.canvasLayout != null) {
    return <MarkdownCanvas {...canvasProps} />;
  }
  const propertySchema = typeDef?.propertySchema ?? [];
  const statuses = resolveStatusSchema(typeDef?.statusSchema ?? null);
  // Display mode (ADR-106): task seeds 'checkbox', so a missing typeDef falls
  // back to checkbox. 'select' keeps status in the field strip (the dropdown);
  // 'checkbox' renders a done-checkbox section instead; 'none' shows no status.
  const statusMode = typeDef?.statusMode ?? "checkbox";
  const statusDone = item.statusCategory === "done";
  const today = appTodayYmd();
  const props = (item.properties as Record<string, unknown>) ?? {};

  const recurrenceRule = parseRecurrence(props.recurrence);
  const reminderObj = props.reminder as Record<string, unknown> | undefined;
  const reminderMinutes =
    typeof reminderObj?.minutesBefore === "number" ? reminderObj.minutesBefore : null;
  const scheduledTime = parseScheduledTime(item.properties);

  const relationFields = propertySchema.filter((p) => p.kind === "relation");
  const scalarFields = propertySchema.filter((p) => p.kind !== "relation");

  // Parent breadcrumb (a subtask points up to its parent task).
  const parent = item.parentId ? await getItem(ownerId, item.parentId).catch(() => null) : null;
  const parentLink =
    parent && !parent.deletedAt ? { href: `/items/${parent.id}`, title: parent.title || "Untitled" } : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 md:px-10">
      {parentLink && (
        <Link
          href={parentLink.href}
          className="mb-2 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
        >
          ↑ <span className="max-w-[20rem] truncate">{parentLink.title}</span>
        </Link>
      )}

      {/* Two-pane: title/body/subtasks + a collapsible details rail. Shared with
          the event canvas (ADR-158); tasks opt out of drag-resize (the compact
          rail rarely needs widening) but keep collapse, remembering its own state
          under the "task" storage key. */}
      <CanvasTwoPane
        storageKey="task"
        resizable={false}
        defaultWidth={340}
        main={
          <div className="min-w-0">
            <TaskTitle
              item={{ id: item.id, title: item.title, body: item.body }}
              done={statusDone}
              priority={item.urgency}
              showCircle={statusMode === "checkbox"}
            />
            <div className="mt-3">
              <ItemEditor
                item={{ id: item.id, title: item.title, body: item.body }}
                slot="body"
                collapsibleToolbar
                compactBody
              />
            </div>
            <div className="mt-4">
              <Subtasks ownerId={ownerId} itemId={item.id} parentScheduled={item.scheduledDate ?? null} />
            </div>
          </div>
        }
        rail={
          // The task's details as a clean divided list of rows. The heavy editors
          // (date · time · repeat · reminder) collapse behind the single Schedule
          // row's popover (ADR-108); everything stays one tap away but out of
          // sight until needed.
          <div className="flex flex-col">
          {/* Status: the completion circle now lives next to the title in
              checkbox mode (TaskTitle), so the rail only carries a status row
              for multi-status 'select' types; 'none' shows nothing (ADR-106/108). */}
          {statusMode === "select" && (
            <div className={RAIL_ROW}>
              <StatusRow itemId={item.id} statuses={statuses} initial={item.status} />
            </div>
          )}

          {/* Schedule: scheduled date + time-of-day + repeat + reminder, tucked
              into one popover. */}
          <div className={RAIL_ROW}>
            <SchedulePopover
              itemId={item.id}
              today={today}
              scheduled={item.scheduledDate?.toISOString() ?? null}
              due={item.dueDate?.toISOString() ?? null}
              recurrence={recurrenceRule}
              scheduledTime={scheduledTime}
              reminderMinutes={reminderMinutes}
              done={statusDone}
            />
          </div>
          <div className={RAIL_ROW}>
            <DueRow itemId={item.id} initial={item.dueDate?.toISOString() ?? null} today={today} done={statusDone} />
          </div>
          <div className={RAIL_ROW}>
            <PriorityRow itemId={item.id} initial={item.urgency} />
          </div>

          {/* Properties: scalar + relation fields under one header (the canvas
              redesign), bare so the compact rail stays a divided list, not a card
              (Brandon, 2026-06-27). Relations are marked with a link glyph. */}
          {propertySchema.length > 0 && (
            <div className={`${RAIL_ROW} ${RAIL_STATIC}`}>
              <CanvasSection bare icon="properties" title="Properties">
                <div className="flex flex-col gap-2">
                  <CustomProperties itemId={item.id} typeKey="task" schema={scalarFields} initial={props} hideHeading bare />
                  <RelationProperties ownerId={ownerId} itemId={item.id} typeKey="task" props={relationFields} hideHeading bare />
                </div>
              </CanvasSection>
            </div>
          )}

          {/* Focus today: a one-tap star, kept in plain sight (not behind a
              popover) since it's a frequent daily action. */}
          <div className={`${RAIL_ROW} ${RAIL_STATIC}`}>
            <span className="flex items-center gap-2 text-sm text-ink">
              <FocusStar itemId={item.id} focused={isFocusedOn(item.properties, today)} today={today} />
              Focus today
            </span>
          </div>
          </div>
        }
      />

      <RelatedPanel ownerId={ownerId} itemId={item.id} />
      <ItemUtilitiesFooter itemId={item.id} currentText={bodyMarkdown(item.body)} />
    </div>
  );
}
