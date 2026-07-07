import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import {
  confirmRoster,
  setAttendance,
  type AttendanceState,
} from "@/lib/events/people";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/events/[id]/attendance — resolve attendance on the People card
// (ADR-144). Body is one of:
//   { personId, state: "here" | "absent" | "none" }  — one person's mark
//   { allHere: true }                                 — confirm the whole roster
// "here"/"absent" are mutually exclusive and also confirm/clear any suggested
// edge for the pair; "none" removes both marks.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const eventId = asUuid((await context.params).id, "id");
    const raw = (await request.json()) as Record<string, unknown> | null;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ItemError("bad_request", "request body must be a JSON object");
    }
    if (raw.allHere === true) {
      const added = await confirmRoster(owner.id, eventId);
      return NextResponse.json({ added });
    }
    const personId = asUuid(raw.personId, "personId");
    const state = raw.state;
    if (state !== "here" && state !== "absent" && state !== "none") {
      throw new ItemError("bad_request", "state must be 'here', 'absent', or 'none'");
    }
    await setAttendance(owner.id, eventId, personId, state as AttendanceState);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
