import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/modules/agent/lib/gate";
import { deleteSession, getSession, updateSession } from "@/modules/agent/lib/chat";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET — the chat with its transcript, any pending approval, and its live turn.
export async function GET(request: Request, ctx: Ctx) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const data = await getSession(owner.id, (await ctx.params).id);
  return data ? NextResponse.json(data) : new NextResponse(null, { status: 404 });
}

// PATCH {title?, archived?, keep?} — rename, archive, or keep a side chat.
export async function PATCH(request: Request, ctx: Ctx) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  await updateSession(owner.id, (await ctx.params).id, {
    title: typeof b.title === "string" ? b.title : undefined,
    archived: typeof b.archived === "boolean" ? b.archived : undefined,
    keep: b.keep === true,
  });
  return new NextResponse(null, { status: 204 });
}

// DELETE — close (discard) a side chat, or delete a chat outright.
export async function DELETE(request: Request, ctx: Ctx) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  await deleteSession(owner.id, (await ctx.params).id);
  return new NextResponse(null, { status: 204 });
}
