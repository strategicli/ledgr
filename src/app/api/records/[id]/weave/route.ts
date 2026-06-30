import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { proposeStoryUpdate, weaveStory } from "@/lib/overview/weave";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/records/[id]/weave — propose an editable Story skeleton from the
// activity since the last weave (the deterministic "what happened when"). The
// caller (the Overview widget, or a Claude-over-MCP polish step) edits it, then:
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    return NextResponse.json(await proposeStoryUpdate(owner.id, id));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/records/[id]/weave { lines: string[] } — accept the (edited) prose
// into the Story, versioning the body and stamping overview_woven (PRD §6).
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    const raw = (await request.json()) as Record<string, unknown>;
    const lines = Array.isArray(raw.lines)
      ? raw.lines.filter((l): l is string => typeof l === "string")
      : [];
    return NextResponse.json(await weaveStory(owner.id, id, lines));
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
