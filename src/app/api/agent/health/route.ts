import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentAvailable, sameOrigin } from "@/modules/agent/lib/gate";
import { authMode, explainError, health, lockedOptions, noteError, noteOk, resultError, run } from "@/modules/agent/lib/runtime";
import { usageByDay } from "@/modules/agent/lib/chat";
import { requireOwner } from "@/lib/api";
import { routeGate } from "@/lib/modules/gate";

export const dynamic = "force-dynamic";

function sdkVersion(): string | null {
  try {
    const p = join(process.cwd(), "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json");
    return (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

// GET /api/agent/health — the assistant's settings status line. Like every
// other agent route it answers only while the module is on (ADR-272): an off
// module has no settings panel to feed.
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "agent");
  if (off) return off;
  const available = agentAvailable();
  return NextResponse.json({
    available,
    authMode: authMode(),
    sdkVersion: sdkVersion(),
    lastOkAt: health.lastOkAt,
    lastError: health.lastError,
    usage: available ? await usageByDay(owner.id) : [],
  });
}

// POST /api/agent/health — "Check sign-in": one tool-less, one-turn call on the
// cheapest model, so the owner can prove the login works (after switching the
// agent on, or after a restart, when the in-process health above is blank).
// Only while the module is on (ADR-272).
export async function POST(request: Request) {
  if (!agentAvailable()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "agent");
  if (off) return off;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  try {
    const opts = lockedOptions({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "Reply with the single word ok.",
      maxTurns: 1,
      abort,
    });
    for await (const m of run("ok?", opts)) {
      if (m.type !== "result") continue;
      if (m.is_error) throw new Error(resultError(m));
      noteOk();
      return NextResponse.json({ ok: true, lastOkAt: health.lastOkAt });
    }
    throw new Error("Claude ended without a result");
  } catch (e) {
    const message = explainError(e instanceof Error ? e.message : String(e));
    noteError(message);
    return NextResponse.json({ ok: false, error: message });
  } finally {
    clearTimeout(timer);
  }
}
