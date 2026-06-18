// POST /api/meetings/[id]/transcribe — start transcription from an already-
// uploaded audio attachment on this meeting (meeting recording v1b, ADR-088).
// Body: {attachmentId}. Creates the transcript child + submits the audio to the
// transcription provider; the panel then polls /api/transcription/[id]/status.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { startAudioTranscription } from "@/lib/meetings/transcription-service";

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
    const attachmentId = asUuid((raw as Record<string, unknown>)?.attachmentId, "attachmentId");
    const result = await startAudioTranscription(owner.id, meetingId, attachmentId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
