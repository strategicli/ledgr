import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/lib/agent/gate";
import { turns } from "@/lib/agent/chat";
import { streamTurn } from "@/lib/agent/sse";

export const dynamic = "force-dynamic";

// GET /api/agent/turn/:id/stream?from=N — reattach to a running turn (the
// phone slept, the page reloaded). 404 once the turn has finished and aged out;
// the client then just reloads the session's stored messages.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const turn = turns.get((await ctx.params).id);
  if (!turn || turn.ownerId !== owner.id) return new NextResponse(null, { status: 404 });
  const from = Number(new URL(request.url).searchParams.get("from") ?? 0) || 0;
  return streamTurn(turn, request.signal, from);
}
