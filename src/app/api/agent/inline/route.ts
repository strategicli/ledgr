import { NextResponse } from "next/server";
import { requireAgentOwner } from "@/modules/agent/lib/gate";
import { runInlineEdit } from "@/modules/agent/lib/inline";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// POST /api/agent/inline — one inline-edit proposal for a selection (ADR-271).
export async function POST(request: Request) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const instruction = str(b.instruction, 2000).trim();
  if (!instruction) return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  try {
    const out = await runInlineEdit(owner.id, {
      itemId: typeof b.itemId === "string" ? b.itemId : null,
      itemTitle: str(b.itemTitle, 300),
      itemType: str(b.itemType, 60) || "note",
      instruction,
      selected: str(b.selected, 40_000),
      before: str(b.before, 4000),
      after: str(b.after, 4000),
      baseHash: typeof b.baseHash === "string" ? b.baseHash : null,
      commandPromptId: typeof b.commandPromptId === "string" ? b.commandPromptId : null,
      voice: b.voice === true,
    });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
