// GET /api/transcription/[id]/status — advance one transcript's transcription
// job by polling the provider, and return its current status (meeting recording
// v1b, ADR-088). The Transcript panel calls this every few seconds while a
// transcript is transcribing (the client-poll path); the cron backstop
// (/api/machine/transcription-poll) advances the rest. Idempotent.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { advanceTranscription } from "@/lib/meetings/transcription-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const result = await advanceTranscription(owner.id, id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
