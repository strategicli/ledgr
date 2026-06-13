// The default item canvas (PRD §4.13): the markdown editor is the star, with
// the type's at-a-glance fields in a horizontal top strip and the standard
// bottom zone — the type's panel (subtasks, meeting prep, or embedded entity
// view), the backlinks panel, Save Offline, Share, and a collapsed read-only
// Fields section for everything the strip doesn't show.
//
// Every type without a bespoke canvas renders through this (the per-type
// canvas seam, ADR-041). A module canvas (a chord grid, a paper workspace)
// either replaces it or, like LinkCanvas, wraps it.
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import FieldStrip, { type StripValues } from "@/components/canvas/FieldStrip";
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import MeetingPrep from "@/components/meetings/MeetingPrep";
import EmbeddedView from "@/components/views/EmbeddedView";
import RelatedPanel from "@/components/relations/RelatedPanel";
import Subtasks from "@/components/subtasks/Subtasks";
import { topStripFields, footerFieldsFor } from "@/lib/canvas-fields";
import type { CanvasProps } from "@/lib/modules";

export default function MarkdownCanvas({ item, ownerId }: CanvasProps) {
  const fields = topStripFields(item.type);
  const strip: StripValues = {
    status: item.status,
    dueDate: item.dueDate?.toISOString() ?? null,
    urgency: item.urgency,
    meetingAt: item.meetingAt?.toISOString() ?? null,
    url: item.url,
    kind: item.kind,
  };
  const footerFields = footerFieldsFor(item);

  return (
    <>
      <ItemEditor
        item={{ id: item.id, title: item.title, body: item.body }}
        fields={
          fields.length > 0 ? (
            <FieldStrip itemId={item.id} fields={fields} initial={strip} />
          ) : null
        }
      />
      {/* Subtasks are a task feature (ADR-018); a future project treatment
          may widen this, but meetings and notes don't grow checklists. */}
      {item.type === "task" && <Subtasks ownerId={ownerId} itemId={item.id} />}
      {/* Meeting prep (PRD §5.1): the person's open tasks, recent meetings,
          agenda, and action-item -> task promotion. */}
      {item.type === "meeting" && <MeetingPrep ownerId={ownerId} itemId={item.id} />}
      {/* Embedded query view (PRD §4.9): an interactive, filterable view of
          items related to this entity — inline check-off, create-inherits,
          remove = un-relate. The actionable surface for a 1:1 prep. */}
      {item.type === "entity" && <EmbeddedView hostId={item.id} />}
      {/* Backlinks panel (PRD §4.9): every item shows what links here. On an
          entity this is the slice-6 "tag as dashboard" Related section. */}
      <RelatedPanel ownerId={ownerId} itemId={item.id} itemType={item.type} />
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
