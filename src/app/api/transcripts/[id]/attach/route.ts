// POST /api/transcripts/[id]/attach — attach an inbox transcript (created from
// an Android-shared .txt, createInboxTranscript) to a meeting. Body is either
// {meetingId} for an existing meeting or {newMeetingTitle} to spin one up and
// attach in a single step. Returns {meetingId} so the share picker can navigate
// to the meeting, where the transcript now shows in the Transcripts panel.
import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { createItem } from "@/lib/item-mutations";
import { attachTranscriptToMeeting } from "@/lib/meetings/transcripts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const transcriptId = asUuid((await context.params).id, "id");
    const raw = await request.json().catch(() => {
      throw new ItemError("bad_request", "request body must be JSON");
    });
    const body = (raw ?? {}) as Record<string, unknown>;

    let meetingId: string;
    const newTitle =
      typeof body.newMeetingTitle === "string" ? body.newMeetingTitle.trim() : "";
    if (newTitle) {
      const meeting = await createItem(owner.id, {
        type: "event",
        title: newTitle.slice(0, 300),
        // The meeting it transcribes already happened; stamp "now" so it sorts
        // naturally and reads as recent. The owner can adjust the time after.
        meetingAt: new Date(),
      });
      meetingId = meeting.id;
    } else {
      meetingId = asUuid(body.meetingId, "meetingId");
    }

    await attachTranscriptToMeeting(owner.id, transcriptId, meetingId);
    return NextResponse.json({ meetingId });
  } catch (err) {
    return errorResponse(err);
  }
}
