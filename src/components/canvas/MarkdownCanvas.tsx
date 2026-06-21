// The default item canvas (PRD §4.13): the markdown editor is the star, with
// the type's at-a-glance fields in a horizontal top strip and the standard
// bottom zone — the type's panel (subtasks, meeting prep, or embedded entity
// view), the backlinks panel, Save Offline, Share, and a collapsed read-only
// Fields section for everything the strip doesn't show.
//
// Every type without a bespoke canvas renders through this (the per-type
// canvas seam, ADR-041). A module canvas (a chord grid, a paper workspace)
// either replaces it or, like LinkCanvas, wraps it.
//
// Per-type layout (ADR-069, Feature B): a type with no saved canvas_layout
// renders the classic stacked canvas below, untouched (the common case, zero
// risk). A type WITH a saved layout — or any type while arranging (?arrange=1) —
// renders the same content as field-level cards in an arrangeable react-grid
// layout: MarkdownCanvas builds each card's content into a Record<CardId,
// ReactNode> and hands it to the client ItemLayoutGrid, which only positions it.
import type { ReactNode } from "react";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import FieldStrip, { type StripValues } from "@/components/canvas/FieldStrip";
import ItemLayoutGrid from "@/components/canvas/ItemLayoutGrid";
import CustomProperties from "@/components/build/CustomProperties";
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import HistoryPanel from "@/components/canvas/HistoryPanel";
import { bodyMarkdown } from "@/lib/body";
import MeetingPrep from "@/components/meetings/MeetingPrep";
import MeetingTranscripts from "@/components/meetings/MeetingTranscripts";
import { promotedBlockRefs } from "@/lib/meetings/promote";
import { getItem } from "@/lib/items";
import Link from "next/link";
import RecurrenceControl from "@/components/canvas/RecurrenceControl";
import RecurrenceCalendar from "@/components/canvas/RecurrenceCalendar";
import ReminderControl from "@/components/canvas/ReminderControl";
import ScheduledTimeControl from "@/components/canvas/ScheduledTimeControl";
import { parseScheduledTime } from "@/lib/scheduled-time";
import FocusStar from "@/components/today/FocusStar";
import { isFocusedOn } from "@/lib/focus";
import RelatedPanel from "@/components/relations/RelatedPanel";
import RelationProperties from "@/components/relations/RelationProperties";
import Subtasks from "@/components/subtasks/Subtasks";
import { topStripFields, footerFieldsFor, type CanvasField } from "@/lib/canvas-fields";
import {
  cardLabel,
  cardVocabulary,
  defaultLayout,
  reconcile,
  type CardId,
} from "@/lib/canvas-layout";
import { getType } from "@/lib/types";
import { resolveStatusSchema } from "@/lib/status";
import { parseRecurrence } from "@/lib/recurrence";
import { appTodayYmd } from "@/lib/recurrence-service";
import type { CanvasProps } from "@/lib/modules";

export default async function MarkdownCanvas({ item, ownerId, arrange = false }: CanvasProps) {
  // A locked item (items.properties.locked, set from the canvas "⋯" menu)
  // renders title, body, field strip, and properties read-only.
  const locked = Boolean(
    (item.properties as Record<string, unknown> | null)?.locked
  );
  const fields = topStripFields(item.type);
  const strip: StripValues = {
    status: item.status,
    dueDate: item.dueDate?.toISOString() ?? null,
    scheduledDate: item.scheduledDate?.toISOString() ?? null,
    urgency: item.urgency,
    meetingAt: item.meetingAt?.toISOString() ?? null,
    url: item.url,
  };
  const footerFields = footerFieldsFor(item);
  // The type's custom fields (Build surface). A user type resolves through the
  // default canvas, so this is where its properties get an editable surface.
  const typeDef = await getType(item.type).catch(() => null);
  const propertySchema = typeDef?.propertySchema ?? [];
  // The type's resolved statuses (S2) for the status dropdown (labels + colors).
  const statuses = resolveStatusSchema(typeDef?.statusSchema ?? null);
  const savedLayout = typeDef?.canvasLayout ?? null;
  // Canvas tabs (ADR-095): auto-on for notes; opt-in for any other type via the
  // bespoke-tool catalog (the `tabs` capability, ADR-051). Tabs are sections of
  // the same markdown body, so this only changes the body editor.
  const tabsEnabled = item.type === "note" || typeDef?.capability === "tabs";
  // Today (app timezone) anchors a newly-enabled repeat; computed once for both
  // the classic mount and the grid card.
  const today = appTodayYmd();
  // Block anchors (ADR-090): a meeting's promoted lines (→ a "✓ task" badge), and
  // a promoted task's back-link to the exact meeting line it came from.
  const promotedRefs =
    item.type === "event" ? await promotedBlockRefs(ownerId, item.id) : undefined;
  const sourceObj =
    item.type === "task"
      ? ((item.properties as Record<string, unknown> | null)?.source as
          | { itemId?: string; blockRef?: string }
          | undefined)
      : undefined;
  let sourceLink: { href: string; title: string } | null = null;
  if (sourceObj?.itemId && sourceObj?.blockRef) {
    const src = await getItem(ownerId, sourceObj.itemId).catch(() => null);
    if (src && !src.deletedAt) {
      sourceLink = {
        href: `/items/${src.id}#^${sourceObj.blockRef}`,
        title: src.title || "Untitled",
      };
    }
  }
  const recurrenceRule = parseRecurrence(
    (item.properties as Record<string, unknown> | null)?.recurrence
  );
  const recurrenceNode = (
    <RecurrenceControl
      itemId={item.id}
      initial={recurrenceRule}
      scheduledDate={item.scheduledDate?.toISOString() ?? null}
      dueDate={item.dueDate?.toISOString() ?? null}
      today={today}
    />
  );
  // The completions calendar (S3): only for a recurring VIRTUAL series — a
  // materialized series' occurrences are their own items with their own
  // checkboxes, so editing the series log there would desync.
  const recurrenceCalendarNode =
    recurrenceRule && recurrenceRule.occurrenceMode === "virtual" ? (
      <RecurrenceCalendar itemId={item.id} initial={recurrenceRule} today={today} />
    ) : null;
  // Task canvas extras (S6, ADR-086): a focus-today star + the per-task reminder
  // lead-time picker (the ICS feed honors it). Classic-path only — the default
  // canvas; a custom grid layout can add these later.
  const reminderObj = (item.properties as Record<string, unknown> | null)?.reminder as
    | Record<string, unknown>
    | undefined;
  const reminderMinutes =
    typeof reminderObj?.minutesBefore === "number" ? reminderObj.minutesBefore : null;
  // Stage A time-blocking: a start time + length on the scheduled day, only
  // meaningful when there IS a scheduled day (a date or a recurrence anchor).
  const scheduledTime = parseScheduledTime(item.properties);
  const hasSchedule = item.scheduledDate != null || recurrenceRule != null;
  const taskExtrasNode = (
    <section className="mx-auto w-full max-w-3xl px-4 pb-1 pt-1 sm:px-8 md:px-12">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <FocusStar itemId={item.id} focused={isFocusedOn(item.properties, today)} today={today} />
          Focus today
        </span>
        <ScheduledTimeControl itemId={item.id} initial={scheduledTime} hasSchedule={hasSchedule} />
        <ReminderControl itemId={item.id} initialMinutes={reminderMinutes} />
      </div>
    </section>
  );

  // Dispatch: render the grid when arranging OR when this type has a saved layout
  // (field-level placement can't be a vertical stack). Otherwise the classic
  // stacked canvas, exactly as before.
  const useGrid = arrange || savedLayout != null;

  if (useGrid) {
    const propsObj = (item.properties as Record<string, unknown>) ?? {};
    // The read-only system footer (Type/Created/Updated + non-strip fields) as a
    // bare definition list — the card header already labels it "Details".
    const metaNode = (
      <dl className="flex flex-col gap-1 px-2">
        {footerFields.map(({ label, value }) => (
          <div key={label} className="flex gap-3 text-sm">
            <dt className="w-20 shrink-0 text-neutral-600">{label}</dt>
            <dd className="min-w-0 break-words text-neutral-400">{value}</dd>
          </div>
        ))}
      </dl>
    );

    const nodeFor = (id: CardId): ReactNode => {
      if (id === "title")
        return (
          <ItemEditor
            item={{ id: item.id, title: item.title, body: item.body }}
            slot="title"
            locked={locked}
          />
        );
      if (id === "body")
        return (
          <ItemEditor
            item={{ id: item.id, title: item.title, body: item.body }}
            slot="body"
            promoteToMeetingId={item.type === "event" ? item.id : undefined}
            promotedRefs={promotedRefs}
            tabsEnabled={tabsEnabled}
            locked={locked}
          />
        );
      if (id.startsWith("sys:")) {
        const f = id.slice(4) as CanvasField;
        return <FieldStrip itemId={item.id} fields={[f]} initial={strip} today={today} statuses={statuses} locked={locked} />;
      }
      if (id === "recurrence") return item.type === "task" ? recurrenceNode : null;
      if (id === "recurrenceCalendar")
        return item.type === "task" ? recurrenceCalendarNode : null;
      if (id === "subtasks")
        return (
          <Subtasks ownerId={ownerId} itemId={item.id} parentScheduled={item.scheduledDate ?? null} />
        );
      if (id === "meetingPrep") return <MeetingPrep ownerId={ownerId} itemId={item.id} />;
      if (id === "meetingTranscripts")
        return <MeetingTranscripts ownerId={ownerId} itemId={item.id} />;
      if (id.startsWith("prop:")) {
        const key = id.slice(5);
        const def = propertySchema.find((p) => p.key === key);
        return def ? (
          <CustomProperties
            itemId={item.id}
            typeKey={item.type}
            schema={[def]}
            initial={propsObj}
            hideHeading
            locked={locked}
          />
        ) : null;
      }
      if (id.startsWith("rel:")) {
        const key = id.slice(4);
        const def = propertySchema.find((p) => p.key === key);
        return def ? (
          <RelationProperties
            ownerId={ownerId}
            itemId={item.id}
            typeKey={item.type}
            props={[def]}
            hideHeading
          />
        ) : null;
      }
      if (id === "related") return <RelatedPanel ownerId={ownerId} itemId={item.id} />;
      if (id === "saveOffline") return <SaveOffline itemId={item.id} />;
      if (id === "share") return <ShareLink itemId={item.id} />;
      if (id === "history")
        return <HistoryPanel itemId={item.id} currentText={bodyMarkdown(item.body)} />;
      if (id === "meta") return metaNode;
      return null;
    };

    const order = cardVocabulary(item.type, propertySchema);
    const nodes: Record<CardId, ReactNode> = {};
    const labels: Record<CardId, string> = {};
    for (const id of order) {
      const node = nodeFor(id);
      if (node != null) {
        nodes[id] = node;
        labels[id] = cardLabel(id, propertySchema);
      }
    }
    const initialLayout = savedLayout
      ? reconcile(savedLayout, item.type, propertySchema)
      : defaultLayout(item.type, propertySchema);

    return (
      <>
        {/* "Customize layout" now lives in the canvas "⋯" actions menu. */}
        <ItemLayoutGrid
          itemId={item.id}
          typeKey={item.type}
          order={order}
          nodes={nodes}
          labels={labels}
          initialLayout={initialLayout}
          arrange={arrange}
        />
      </>
    );
  }

  // Classic stacked canvas (null layout, not arranging) — unchanged.
  // ("Customize layout" now lives in the canvas "⋯" actions menu.)
  return (
    <>
      <ItemEditor
        item={{ id: item.id, title: item.title, body: item.body }}
        fields={
          fields.length > 0 ? (
            <FieldStrip itemId={item.id} fields={fields} initial={strip} today={today} statuses={statuses} locked={locked} />
          ) : null
        }
        promoteToMeetingId={item.type === "event" ? item.id : undefined}
        promotedRefs={promotedRefs}
        tabsEnabled={tabsEnabled}
        locked={locked}
      />
      {/* Block-anchor back-link (ADR-090): a promoted task points to the exact
          meeting line it came from; clicking deep-links + flashes that line. */}
      {sourceLink && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-1 text-xs text-neutral-500 sm:px-8 md:px-12">
          ↳ from{" "}
          <Link href={sourceLink.href} className="text-neutral-400 hover:text-neutral-200 hover:underline">
            {sourceLink.title}
          </Link>
        </div>
      )}
      {/* Repeat control (native tasks, ADR-073/076): sets the task's recurrence
          rule; completion then advances the schedule deterministically. */}
      {item.type === "task" && recurrenceNode}
      {/* Completions calendar (S3, ADR-083): tick occurrence dates in any order;
          ✎ a date to carve it into a detached one-off. Recurring virtual only. */}
      {item.type === "task" && recurrenceCalendarNode}
      {/* Focus star + reminder lead-time (S6, ADR-086). */}
      {item.type === "task" && taskExtrasNode}
      {/* Subtasks are a task feature (ADR-018); a future project treatment
          may widen this, but meetings and notes don't grow checklists. */}
      {item.type === "task" && (
        <Subtasks ownerId={ownerId} itemId={item.id} parentScheduled={item.scheduledDate ?? null} />
      )}
      {/* Meeting prep (PRD §5.1): the people, their open tasks, recent
          meetings, and action-item -> task promotion. */}
      {item.type === "event" && <MeetingPrep ownerId={ownerId} itemId={item.id} />}
      {/* Transcripts (meeting recording v1a, ADR-087): paste/list a meeting's
          transcripts (each its own item), the pivot for Claude-over-MCP minutes. */}
      {item.type === "event" && <MeetingTranscripts ownerId={ownerId} itemId={item.id} />}
      {/* Custom properties (PRD §3.6): the type's scalar Build-surface fields,
          edited in place over items.properties. CustomProperties skips relation
          kinds (their value is edges, not properties). */}
      {propertySchema.length > 0 && (
        <CustomProperties
          itemId={item.id}
          typeKey={item.type}
          schema={propertySchema}
          initial={(item.properties as Record<string, unknown>) ?? {}}
          locked={locked}
        />
      )}
      {/* Typed relation fields (ADR-067): the type's `relation` properties as
          link boxes, reading/writing relations edges with role = the field key. */}
      <RelationProperties
        ownerId={ownerId}
        itemId={item.id}
        typeKey={item.type}
        props={propertySchema}
      />
      {/* Related panel (PRD §4.9): every item shows what links here, with
          related tasks check-off-able and due-dates editable in place — the
          actionable "tag as dashboard" surface, now universal (ADR-055). */}
      <RelatedPanel ownerId={ownerId} itemId={item.id} />
      {/* Save Offline (PRD §4.7): export now, verified offline pin, print/PDF. */}
      <SaveOffline itemId={item.id} />
      {/* Public share link (PRD §4.12): read-only, print-friendly, PDF. */}
      <ShareLink itemId={item.id} />
      {/* Version history (Track changes): list snapshots, diff any two, restore
          (the general item-view undo). Lazy — fetches only when expanded. */}
      <HistoryPanel itemId={item.id} currentText={bodyMarkdown(item.body)} />
      <details className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 sm:px-8 md:px-12">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:text-neutral-400">
          Fields
        </summary>
        <dl className="mt-2 flex flex-col gap-1 px-2">
          {footerFields.map(({ label, value }) => (
            <div key={label} className="flex gap-3 text-sm">
              <dt className="w-20 shrink-0 text-neutral-600">{label}</dt>
              <dd className="min-w-0 break-words text-neutral-400">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
