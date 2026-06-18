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
import MeetingPrep from "@/components/meetings/MeetingPrep";
import RecurrenceControl from "@/components/canvas/RecurrenceControl";
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
  // Today (app timezone) anchors a newly-enabled repeat; computed once for both
  // the classic mount and the grid card.
  const today = appTodayYmd();
  const recurrenceNode = (
    <RecurrenceControl
      itemId={item.id}
      initial={parseRecurrence(
        (item.properties as Record<string, unknown> | null)?.recurrence
      )}
      scheduledDate={item.scheduledDate?.toISOString() ?? null}
      dueDate={item.dueDate?.toISOString() ?? null}
      today={today}
    />
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
          />
        );
      if (id === "body")
        return (
          <ItemEditor
            item={{ id: item.id, title: item.title, body: item.body }}
            slot="body"
          />
        );
      if (id.startsWith("sys:")) {
        const f = id.slice(4) as CanvasField;
        return <FieldStrip itemId={item.id} fields={[f]} initial={strip} today={today} statuses={statuses} />;
      }
      if (id === "recurrence") return item.type === "task" ? recurrenceNode : null;
      if (id === "subtasks") return <Subtasks ownerId={ownerId} itemId={item.id} />;
      if (id === "meetingPrep") return <MeetingPrep ownerId={ownerId} itemId={item.id} />;
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
        {!arrange && (
          <div className="flex w-full justify-end px-6 pt-4 sm:px-10">
            {/* Hard nav (plain <a>) so ?arrange=1 escapes the intercept modal. */}
            <a
              href={`/items/${item.id}?arrange=1`}
              className="text-xs text-neutral-600 hover:text-neutral-400"
            >
              Customize layout
            </a>
          </div>
        )}
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
  return (
    <>
      <div className="mx-auto flex w-full max-w-3xl justify-end px-12 pt-4">
        {/* Hard nav (plain <a>) so ?arrange=1 escapes the intercept modal. */}
        <a
          href={`/items/${item.id}?arrange=1`}
          className="text-xs text-neutral-600 hover:text-neutral-400"
        >
          Customize layout
        </a>
      </div>
      <ItemEditor
        item={{ id: item.id, title: item.title, body: item.body }}
        fields={
          fields.length > 0 ? (
            <FieldStrip itemId={item.id} fields={fields} initial={strip} today={today} statuses={statuses} />
          ) : null
        }
      />
      {/* Repeat control (native tasks, ADR-073/076): sets the task's recurrence
          rule; completion then advances the schedule deterministically. */}
      {item.type === "task" && recurrenceNode}
      {/* Subtasks are a task feature (ADR-018); a future project treatment
          may widen this, but meetings and notes don't grow checklists. */}
      {item.type === "task" && <Subtasks ownerId={ownerId} itemId={item.id} />}
      {/* Meeting prep (PRD §5.1): the person's open tasks, recent meetings,
          agenda, and action-item -> task promotion. */}
      {item.type === "meeting" && <MeetingPrep ownerId={ownerId} itemId={item.id} />}
      {/* Custom properties (PRD §3.6): the type's scalar Build-surface fields,
          edited in place over items.properties. CustomProperties skips relation
          kinds (their value is edges, not properties). */}
      {propertySchema.length > 0 && (
        <CustomProperties
          itemId={item.id}
          typeKey={item.type}
          schema={propertySchema}
          initial={(item.properties as Record<string, unknown>) ?? {}}
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
      <details className="mx-auto w-full max-w-3xl px-12 pb-12 pt-4">
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
