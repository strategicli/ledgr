import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/modules/agent/lib/gate";
import { decideApproval } from "@/modules/agent/lib/chat";

export const dynamic = "force-dynamic";

// POST /api/agent/approval/:id {decision: allow_once|deny, note?} — answer a
// delete/share card. There is no "allow for this chat" for those tools.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const b = (await request.json().catch(() => ({}))) as { decision?: string; note?: string };
  if (b.decision !== "allow_once" && b.decision !== "deny") {
    return NextResponse.json({ error: "decision must be allow_once or deny" }, { status: 400 });
  }
  const note = typeof b.note === "string" ? b.note.slice(0, 500) : undefined;
  const ok = await decideApproval(owner.id, (await ctx.params).id, b.decision, note);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "already decided" }, { status: 409 });
}
