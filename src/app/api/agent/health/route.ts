import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentAvailable } from "@/lib/agent/gate";
import { authMode, health } from "@/lib/agent/runtime";
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
