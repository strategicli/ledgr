import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/lib/agent/gate";
import { turns } from "@/lib/agent/chat";

export const dynamic = "force-dynamic";

// POST /api/agent/turn/:id/stop — the Stop button.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const turn = turns.get((await ctx.params).id);
  if (turn && turn.ownerId === owner.id) turn.abort.abort();
  return new NextResponse(null, { status: 204 });
}
