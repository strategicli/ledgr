import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { pinEventAsTemplate } from "@/lib/templates/pin";
import type { MatcherCondition } from "@/lib/matchers/types";

// Pin an event's confirmed match as a standing rule (EM4, ADR-123): create or
// update an `event` template that pre-relates the event's confirmed people and
// carries the match condition (autoApply on), so future matching events apply it.
// User-authed, owner-scoped. Body: { condition?: MatcherCondition; name?: string }
// — condition omitted = derive a sensible default from the event; it's validated
// in the lib (a bad email/regex is rejected there).
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await params;
    let body: { condition?: MatcherCondition; name?: string } = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        body = raw as typeof body;
      }
    } catch {
      // empty/invalid body → derive everything (condition + name) from the event
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      throw new ItemError("bad_request", "name must be a string");
    }
    const result = await pinEventAsTemplate(owner.id, asUuid(id, "id"), {
      condition: body.condition,
      name: body.name,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
