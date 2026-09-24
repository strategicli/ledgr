import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/lib/agent/gate";
import { bringBack } from "@/lib/agent/chat";

export const dynamic = "force-dynamic";

// POST — summarize a side chat into its main chat, then close the side chat.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ summary: await bringBack(owner.id, (await ctx.params).id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
