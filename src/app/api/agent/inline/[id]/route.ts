import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/modules/agent/lib/gate";
import { resolveProposal } from "@/modules/agent/lib/inline";

export const dynamic = "force-dynamic";

// POST {status: accepted|rejected|stale} — record how a proposal ended.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const { status } = (await request.json().catch(() => ({}))) as { status?: string };
  if (status !== "accepted" && status !== "rejected" && status !== "stale") {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  await resolveProposal(owner.id, (await ctx.params).id, status);
  return new NextResponse(null, { status: 204 });
}
