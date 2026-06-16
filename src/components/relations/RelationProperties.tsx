// The typed-relation panel on the item canvas (ADR-067 R2): renders a type's
// `relation` property fields (Author, Attendees, References) as link boxes.
// Server component — it fetches each field's current links in one query
// (outgoingRelationsByRole: edges from this item whose role is the field key)
// and resolves target-type labels, then hands each field to the client
// RelationField. Sits beside the scalar CustomProperties panel; both read the
// same type.property_schema, split by kind in MarkdownCanvas.
import { getDb } from "@/db";
import { types } from "@/db/schema";
import { outgoingRelationsByRole } from "@/lib/relations";
import type { PropertyDef } from "@/lib/types";
import InlineLabel from "@/components/build/InlineLabel";
import RelationField from "./RelationField";

export default async function RelationProperties({
  ownerId,
  itemId,
  typeKey,
  props,
}: {
  ownerId: string;
  itemId: string;
  typeKey: string;
  props: PropertyDef[];
}) {
  const relationProps = props.filter((p) => p.kind === "relation");
  if (relationProps.length === 0) return null;

  const [byRole, typeRows] = await Promise.all([
    outgoingRelationsByRole(
      ownerId,
      itemId,
      relationProps.map((p) => p.key)
    ),
    getDb().select({ key: types.key, label: types.label }).from(types),
  ]);
  const labels = new Map(typeRows.map((t) => [t.key, t.label]));

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pb-6 pt-2">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        Relations
      </h2>
      <dl className="flex flex-col gap-2">
        {relationProps.map((prop) => (
          <div key={prop.key} className="flex items-start gap-3 text-sm">
            <dt className="w-32 shrink-0 pt-1 text-neutral-500">
              <InlineLabel
                typeKey={typeKey}
                propertyKey={prop.key}
                label={prop.label}
              />
            </dt>
            <dd className="min-w-0 flex-1">
              <RelationField
                itemId={itemId}
                role={prop.key}
                targetType={prop.targetType ?? null}
                targetTypeLabel={
                  prop.targetType ? (labels.get(prop.targetType) ?? null) : null
                }
                cardinality={prop.cardinality ?? "many"}
                initial={(byRole.get(prop.key) ?? []).map((r) => ({
                  id: r.id,
                  title: r.title,
                }))}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
