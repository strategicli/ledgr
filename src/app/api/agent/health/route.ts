import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentAvailable } from "@/lib/agent/gate";
import { authMode, explainError, health, lockedOptions, noteError, noteOk, resultError, run } from "@/lib/agent/runtime";
import { usageByDay } from "@/lib/agent/chat";
import { requireOwner } from "@/lib/api";

export const dynamic = "force-dynamic";

function sdkVersion(): string | null {
  try {
    const p = join(process.cwd(), "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json");
    return (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

// GET /api/agent/health — the Settings panel's status line. Unlike the other
// agent routes it answers even while the agent is switched off, so Settings can
// say whether this machine can run it at all.
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
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
// cheapest model, so the owner can prove the login works before switching the
// agent on (and after a restart, when the in-process health above is blank).
export async function POST(request: Request) {
  if (!agentAvailable()) return new NextResponse(null, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new NextResponse(null, { status: 403 });
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
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
