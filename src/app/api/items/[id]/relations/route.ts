import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import {
  confirmRelations,
  relateItems,
  unrelateItems,
} from "@/lib/relations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function parseTarget(raw: unknown): { targetId: string; role?: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ItemError("bad_request", "request body must be a JSON object");
  }
  const input = raw as Record<string, unknown>;
  const out: { targetId: string; role?: string } = {
    targetId: asUuid(input.targetId, "targetId"),
  };
  if (input.role !== undefined) {
    if (typeof input.role !== "string" || !input.role.trim()) {
      throw new ItemError("bad_request", "role must be a non-empty string");
    }
    out.role = input.role.trim();
  }
  return out;
}

// POST /api/items/[id]/relations — relate this item to another (source = the
// item in the URL, per PRD §3.4 tag direction). Body: { targetId, role? }.
// Idempotent: relating an already-related pair is a no-op, and relating over
// an existing suggested edge confirms it.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const { targetId, role } = parseTarget(await request.json());
    const relation = await relateItems(owner.id, id, targetId, role);
    return NextResponse.json({ relation }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// PATCH /api/items/[id]/relations — confirm every suggested edge between the
// pair. Body: { targetId }.
export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const { targetId } = parseTarget(await request.json());
    return NextResponse.json(await confirmRelations(owner.id, id, targetId));
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/items/[id]/relations?targetId=&suggested=true&role= — un-relate
// the pair (both directions, mention edges excluded; the body owns those).
// suggested=true is the reject gesture: it removes only provisional edges.
// role scopes removal to one relation-field edge (ADR-067), so a typed field
// only clears its own link.
export async function DELETE(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const params = new URL(request.url).searchParams;
    const targetId = asUuid(params.get("targetId"), "targetId");
    const suggestedOnly = params.get("suggested") === "true";
    const roleParam = params.get("role");
    const role = roleParam && roleParam.trim() ? roleParam.trim() : undefined;
    return NextResponse.json(
      await unrelateItems(owner.id, id, targetId, { suggestedOnly, role })
    );
  } catch (err) {
    return errorResponse(err);
  }
}
