// Bespoke event/meeting canvas (Principle 6, Brandon 2026-07-10). The meeting is
// the heaviest, densest type (~1,400 items), and neither the longform byline nor
// the task rail fits: a meeting has big sub-panels. So it gets a two-pane shape —
//   left  : title + a compact meeting byline (when) + the notes/agenda body,
//           with `[ ]` lines promotable to tasks (block anchors, ADR-090);
//   right : a sticky, independently-scrolling, collapsible rail carrying the
//           meeting's People card, Open tasks (which doubles as an agenda),
//           Catch-up, and Recent meetings (the whole MeetingPrep panel).
// Below the two panes, full width: the rarely-opened Transcripts and Notes
// (collapsed by default), then Properties, the connected-data web, and the
// shared utilities footer.
//
// Wired to canvasId "event" (module-wiring.tsx). The grid customizer stays the
// per-type override: a saved custom layout — or arrange mode (?arrange=1) —
// delegates to the default canvas's draggable grid, exactly like Task/Longform.
// That is also the "reorder the rail" escape hatch (Brandon chose the existing
// customizer over a second rail-scoped reorder system).
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import MarkdownCanvas from "@/components/canvas/MarkdownCanvas";
import FieldStrip, { type StripValues } from "@/components/canvas/FieldStrip";
import CanvasSection from "@/components/canvas/CanvasSection";
import CustomProperties from "@/components/build/CustomProperties";
import RelationProperties from "@/components/relations/RelationProperties";
import CanvasTwoPane from "@/components/canvas/CanvasTwoPane";
import MeetingPrep from "@/components/meetings/MeetingPrep";
import MeetingNotes from "@/components/meetings/MeetingNotes";
import MeetingTranscripts from "@/components/meetings/MeetingTranscripts";
import RelatedPanel from "@/components/relations/RelatedPanel";
import DiscoverPanel from "@/components/relations/DiscoverPanel";
import ItemUtilitiesFooter from "@/components/canvas/ItemUtilitiesFooter";
import { promotedBlockRefs } from "@/lib/meetings/promote";
import { topStripFields } from "@/lib/canvas-fields";
import { getType } from "@/lib/types";
import { resolveStatusSchema } from "@/lib/status";
import { appTodayYmd } from "@/lib/recurrence-service";
import { bodyMarkdown } from "@/lib/body";
import type { CanvasProps } from "@/lib/modules";

export default async function EventCanvas(canvasProps: CanvasProps) {
  const { item, ownerId, arrange = false, variant } = canvasProps;
  const typeDef = await getType(item.type).catch(() => null);
  // Customizer override: a saved custom layout or arrange mode uses the default
  // canvas's field-level draggable grid (and is the rail-reorder escape hatch).
  // The bespoke two-pane renders in BOTH the full page and the modal — it splits
  // on container width (CanvasTwoPane), so a roomy modal peek shows the dual
  // column and a tight one stacks.
  if (arrange || typeDef?.canvasLayout != null) {
    return <MarkdownCanvas {...canvasProps} />;
  }

  const locked = Boolean((item.properties as Record<string, unknown> | null)?.locked);
  const propertySchema = typeDef?.propertySchema ?? [];
  const statuses = resolveStatusSchema(typeDef?.statusSchema ?? null);
  const today = appTodayYmd();
  const tabsEnabled = typeDef?.capability === "tabs";
  const promotedRefs = await promotedBlockRefs(ownerId, item.id);

  // The meeting byline: when it's scheduled, under the title (the date Brandon
  // liked hoisted up). Editable via the same FieldStrip the other canvases use.
  const fields = topStripFields(item.type); // ["meetingAt"] for event
  const strip: StripValues = {
    status: item.status,
    dueDate: item.dueDate?.toISOString() ?? null,
    scheduledDate: item.scheduledDate?.toISOString() ?? null,
    urgency: item.urgency,
    meetingAt: item.meetingAt?.toISOString() ?? null,
    noteDate: item.noteDate?.toISOString() ?? null,
    url: item.url,
  };
  const byline =
    fields.length > 0 ? (
      <div className="px-2 pt-1 sm:px-8 md:px-12">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-line pb-3 text-sm">
          <FieldStrip
            itemId={item.id}
            fields={fields}
            initial={strip}
            today={today}
            statuses={statuses}
            locked={locked}
            flush
          />
        </div>
      </div>
    ) : null;

  const scalarFields = propertySchema.filter((p) => p.kind !== "relation");
  // Person-target relation fields (Attending) are edited on the People card in
  // the rail (ADR-144) — don't render the same edges twice in Properties.
  const relationFields = propertySchema.filter(
    (p) => p.kind === "relation" && p.targetType !== "person"
  );

  return (
    <>
      <CanvasTwoPane
        storageKey="event"
        // Drag-resize on the full page only; in the modal the peek panel has its
        // own outer resize handle, so an inner one would be a confusing second.
        resizable={variant === "page"}
        main={
          <ItemEditor
            item={{ id: item.id, title: item.title, body: item.body }}
            fields={byline}
            promoteToMeetingId={item.id}
            promotedRefs={promotedRefs}
            tabsEnabled={tabsEnabled}
            collapsibleToolbar
            locked={locked}
          />
        }
        rail={
          // Hairline dividers between MeetingPrep's bare sections (People, Open
          // tasks, Catch-up, Recent) so the rail reads as a divided list.
          <div className="[&>section+section]:mt-4 [&>section+section]:border-t [&>section+section]:border-line [&>section+section]:pt-4">
            <MeetingPrep ownerId={ownerId} itemId={item.id} bare />
          </div>
        }
      />

      {/* Rarely-opened, collapsed by default (Brandon 2026-07-10). */}
      <MeetingTranscripts ownerId={ownerId} itemId={item.id} collapsed />
      <MeetingNotes ownerId={ownerId} itemId={item.id} collapsed />

      {/* Properties: scalar Build-surface fields + non-person relation fields. */}
      {(scalarFields.length > 0 || relationFields.length > 0) && (
        <CanvasSection icon="properties" title="Properties">
          <div className="flex flex-col gap-2">
            <CustomProperties
              itemId={item.id}
              typeKey={item.type}
              schema={scalarFields}
              initial={(item.properties as Record<string, unknown>) ?? {}}
              locked={locked}
              hideHeading
              bare
            />
            <RelationProperties
              ownerId={ownerId}
              itemId={item.id}
              typeKey={item.type}
              props={relationFields}
              hideHeading
              bare
            />
          </div>
        </CanvasSection>
      )}

      <RelatedPanel ownerId={ownerId} itemId={item.id} />
      <DiscoverPanel itemId={item.id} anchorTitle={item.title} />
      <ItemUtilitiesFooter itemId={item.id} currentText={bodyMarkdown(item.body)} />
    </>
  );
}
