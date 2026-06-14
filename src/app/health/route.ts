import { NextResponse } from "next/server";
import { gatherHealth } from "@/lib/health";

// /health: the canary endpoint (runbook.md §2). DB reachability, the last clean
// export/integration runs, the MCP/Graph canaries, the weekly health-check's
// findings, and captured errors. The structured snapshot is assembled in
// `gatherHealth` (src/lib/health.ts) so the scheduled self-monitor reads the
// exact same canaries in-process.
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await gatherHealth();
  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
  });
}
