import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { getItem } from "@/lib/items";
import { getType, listTypes } from "@/lib/types";
import { listRelatedItems, outgoingRelationsByRole } from "@/lib/relations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/items/[id]/details — the read-only aggregation behind the Desk's
// opt-in "Show details" panel (ADR-147 D6). One endpoint gathers what the full
// canvas assembles from a mix of client + server components, so the Desk can
// render it with ONE client component (ItemDetails) instead of mounting server
// pieces: the type's scalar properties (schema + current values), its typed
// relation fields (each with its current links), and the confirmed "Linked
// here" inbound items (minus those already shown as a typed relation, so
// nothing repeats — mirroring MarkdownCanvas). No writes here; property/relation
// edits go through their own field endpoints (PATCH properties, relations API).
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const item = await getItem(owner.id, id);
    const typeDef = await getType(item.type).catch(() => null);
    const schema = typeDef?.propertySchema ?? [];
    const scalarProps = schema.filter((p) => p.kind !== "relation");
    const relationProps = schema.filter((p) => p.kind === "relation");

    const [byRole, related, allTypes] = await Promise.all([
      outgoingRelationsByRole(
        owner.id,
        id,
        relationProps.map((p) => p.key)
      ),
      listRelatedItems(owner.id, id),
      listTypes(),
    ]);
    const typeLabels = new Map(allTypes.map((t) => [t.key, t.label]));

    const relations = relationProps.map((p) => ({
      key: p.key,
      label: p.label ?? p.key,
      targetType: p.targetType ?? null,
      targetTypeLabel: p.targetType ? (typeLabels.get(p.targetType) ?? null) : null,
      cardinality: p.cardinality ?? "many",
      links: (byRole.get(p.key) ?? []).map((r) => ({ id: r.id, title: r.title })),
    }));

    // Items already surfaced as a typed relation are claimed, so "Linked here"
    // doesn't list them twice (the full canvas does the same).
    const claimed = new Set(relations.flatMap((r) => r.links.map((l) => l.id)));
    const linkedHere = related
      .filter((r) => r.matchState === "confirmed" && !claimed.has(r.id))
      .map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        typeLabel: typeLabels.get(r.type) ?? r.type,
      }));

    return NextResponse.json({
      type: item.type,
      properties: {
        schema: scalarProps,
        values: (item.properties as Record<string, unknown>) ?? {},
      },
      relations,
      linkedHere,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
