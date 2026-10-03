import { asUuid } from "@/lib/api";
import { isResponse, machineHttp } from "@/lib/machine/http";
import { routeGate } from "@/lib/modules/gate";
import { createTranscript } from "@/lib/meetings/transcripts";

// POST /api/machine/meetings/[id]/transcripts { title?, text } (ADR-288): the
// token half of POST /api/meetings/[id]/transcripts, through the same
// createTranscript (child item, parentId, meeting->transcript edge,
// properties.minutes = "none"). -> 201 { id }; 404 if the meeting isn't a live
// event of the owner's.
export const dynamic = "force-dynamic";
const http = machineHttp("POST");

export const OPTIONS = http.options;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const a = await http.authorize(request, new Set());
  if (isResponse(a)) return a;
  const body = await http.body(request);
  if (isResponse(body)) return body;
  try {
    const off = await routeGate(a.ownerId, "meeting-transcripts");
    if (off) return http.cors(off);
    const meetingId = asUuid((await context.params).id, "id");
    if (typeof body.text !== "string" || !body.text.trim()) {
      return http.json({ error: "text is required" }, 400);
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      return http.json({ error: "title must be a string" }, 400);
    }
    const created = await createTranscript(a.ownerId, meetingId, {
      title: body.title as string | undefined,
      text: body.text,
    });
    return http.json({ id: created.id }, 201);
  } catch (err) {
    return http.fail(err);
  }
}
