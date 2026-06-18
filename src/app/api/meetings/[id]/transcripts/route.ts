// POST /api/meetings/[id]/transcripts — create a transcript under a meeting
// (meeting recording v1a, ADR-087). createTranscript writes the child item plus
// the confirmed meeting→transcript edge in one place, so the panel's paste box
// can't produce a transcript the MCP graph can't see. Body: {title?, text?}.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { createTranscript } from "@/lib/meetings/transcripts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const meetingId = asUuid((await context.params).id, "id");
    const raw = await request.json().catch(() => {
      throw new ItemError("bad_request", "request body must be JSON");
    });
    const body = (raw ?? {}) as Record<string, unknown>;
    const created = await createTranscript(owner.id, meetingId, {
      title: typeof body.title === "string" ? body.title : undefined,
      text: typeof body.text === "string" ? body.text : undefined,
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
