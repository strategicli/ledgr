// The item canvas (PRD §4.13), shared by the full /items/[id] page and the
// intercepted center modal. Top zone: ancestor breadcrumb + the type's
// at-a-glance fields in a horizontal strip. The body editor is the star.
// Bottom zone: subtasks, related items (entities), and a collapsed read-only
// Fields section for everything the strip doesn't show.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ItemEditor from "@/components/editor/ItemEditor";
import FieldStrip, { type StripValues } from "@/components/canvas/FieldStrip";
import SaveOffline from "@/components/canvas/SaveOffline";
import MeetingPrep from "@/components/meetings/MeetingPrep";
import EmbeddedView from "@/components/views/EmbeddedView";
import RelatedPanel from "@/components/relations/RelatedPanel";
import Subtasks from "@/components/subtasks/Subtasks";
import { topStripFields, type CanvasField } from "@/lib/canvas-fields";
import { ItemError, getItem } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { listAncestors } from "@/lib/subtasks";

const tsFmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ItemCanvas({
  id,
  variant,
}: {
  id: string;
  variant: "page" | "modal";
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  let item;
  try {
    item = await getItem(owner.id, id);
  } catch (err) {
    if (err instanceof ItemError) notFound();
    throw err;
  }
  if (item.deletedAt) notFound(); // Trash items restore first, then open.

  // Hierarchy reads child-upward (PRD §3.5): the breadcrumb is the live
  // ancestor chain, root first.
  const ancestors = item.parentId ? await listAncestors(owner.id, item.id) : [];

  const fields = topStripFields(item.type);
  const strip: StripValues = {
    status: item.status,
    dueDate: item.dueDate?.toISOString() ?? null,
    urgency: item.urgency,
    meetingAt: item.meetingAt?.toISOString() ?? null,
    url: item.url,
    kind: item.kind,
  };

  // The strip's fields don't repeat in the footer; neither do empty ones.
  // Task fields (status, due, urgency) never surface on other types, even
  // when legacy data set them (ADR-018).
  const footerFields: [string, string][] = [["Type", item.type]];
  const maybe = (name: CanvasField, label: string, value: string | null) => {
    if (value && !fields.includes(name)) footerFields.push([label, value]);
  };
  if (item.type === "task") {
    maybe("dueDate", "Due", item.dueDate ? tsFmt.format(item.dueDate) : null);
    maybe("urgency", "Urgency", item.urgency);
  }
  maybe("meetingAt", "When", item.meetingAt ? tsFmt.format(item.meetingAt) : null);
  maybe("url", "URL", item.url);
  maybe("kind", "Kind", item.kind);
  footerFields.push(["Created", tsFmt.format(item.createdAt)]);
  footerFields.push(["Updated", tsFmt.format(item.updatedAt)]);

  const showBreadcrumb = variant === "page" || ancestors.length > 0;

  return (
    <>
      {showBreadcrumb && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-12 pt-6 text-sm text-neutral-500">
          {variant === "page" && (
            <Link href="/items" className="hover:text-neutral-300">
              ← All items
            </Link>
          )}
          {ancestors.map((a, i) => (
            <span key={a.id} className="flex min-w-0 items-center gap-1">
              {(variant === "page" || i > 0) && (
                <span className="text-neutral-700">/</span>
              )}
              <Link
                href={`/items/${a.id}`}
                className="truncate hover:text-neutral-300"
              >
                {a.title || "Untitled"}
              </Link>
            </span>
          ))}
        </div>
      )}
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
      {item.type === "task" && <Subtasks ownerId={owner.id} itemId={item.id} />}
      {/* Meeting prep (PRD §5.1): the person's open tasks, recent meetings,
          agenda, and action-item -> task promotion. */}
      {item.type === "meeting" && <MeetingPrep ownerId={owner.id} itemId={item.id} />}
      {/* Embedded query view (PRD §4.9): an interactive, filterable view of
          items related to this entity — inline check-off, create-inherits,
          remove = un-relate. The actionable surface for a 1:1 prep. */}
      {item.type === "entity" && <EmbeddedView hostId={item.id} />}
      {/* Backlinks panel (PRD §4.9): every item shows what links here. On an
          entity this is the slice-6 "tag as dashboard" Related section. */}
      <RelatedPanel ownerId={owner.id} itemId={item.id} itemType={item.type} />
      {/* Save Offline (PRD §4.7): export now, verified offline pin, print/PDF. */}
      <SaveOffline itemId={item.id} />
      <details className="mx-auto w-full max-w-3xl px-12 pb-12 pt-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:text-neutral-400">
          Fields
        </summary>
        <dl className="mt-2 flex flex-col gap-1 px-2">
          {footerFields.map(([label, value]) => (
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
