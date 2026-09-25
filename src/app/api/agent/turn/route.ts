import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/modules/agent/lib/gate";
import { startTurn } from "@/modules/agent/lib/chat";
import { streamTurn } from "@/modules/agent/lib/sse";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const ids = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 10) : [];

// POST /api/agent/turn — start one chat turn and stream it (ADR-271). The
// client sends only the message and what it points at; the tool list, system
// prompt, permissions, and model are all decided on the server.
export async function POST(request: Request) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = str(b.sessionId);
  const text = str(b.text) ?? "";
  if (!sessionId || (!text.trim() && b.retry !== true)) {
    return NextResponse.json({ error: "sessionId and text are required" }, { status: 400 });
  }
  const answers: Record<string, string> = {};
  if (b.answers && typeof b.answers === "object") {
    for (const [k, v] of Object.entries(b.answers as Record<string, unknown>)) {
      if (typeof v === "string") answers[k] = v;
    }
  }
  try {
    const turn = await startTurn(owner.id, {
      sessionId,
      text,
      retry: b.retry === true,
      itemId: str(b.itemId) ?? null,
      selection: str(b.selection)?.slice(0, 20_000) ?? null,
      mentionIds: ids(b.mentionIds),
      commandPromptId: str(b.commandPromptId) ?? null,
      answers,
    });
    return streamTurn(turn, request.signal);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
