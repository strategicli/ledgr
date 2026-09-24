import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/lib/agent/gate";
import { createSession, getSession, listSessions } from "@/lib/agent/chat";

export const dynamic = "force-dynamic";

// GET /api/agent/sessions?q= — recent chats, newest first.
export async function GET(request: Request) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const q = new URL(request.url).searchParams.get("q") ?? undefined;
  return NextResponse.json({ sessions: await listSessions(owner.id, q) });
}

// POST /api/agent/sessions {kind?: main|side, parentSessionId?, contextItemId?}
// One side chat per main chat: asking again returns the open one.
export async function POST(request: Request) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = b.kind === "side" ? "side" : "main";
  const parent = typeof b.parentSessionId === "string" ? b.parentSessionId : undefined;
  if (kind === "side") {
    if (!parent) return NextResponse.json({ error: "parentSessionId required" }, { status: 400 });
    const p = await getSession(owner.id, parent);
    if (!p) return NextResponse.json({ error: "chat not found" }, { status: 404 });
    if (p.sideSessionId) {
      const open = await getSession(owner.id, p.sideSessionId);
      if (open) return NextResponse.json({ session: open.session });
    }
  }
  const session = await createSession(owner.id, {
    kind,
    parentSessionId: parent,
    contextItemId: typeof b.contextItemId === "string" ? b.contextItemId : null,
  });
  return NextResponse.json({ session });
}
