import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

// /health: the canary endpoint (runbook.md §2). Checks DB reachability now;
// last-export timestamp, Todoist, and Graph checks join it when those exist.
export const dynamic = "force-dynamic";

type Check =
  | { ok: true; latencyMs: number }
  | { ok: false; detail: string };

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    console.error(
      JSON.stringify({
        source: "health",
        check: "database",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    const debug = process.env.DEBUG_MODE === "true";
    return {
      ok: false,
      detail:
        debug && err instanceof Error ? err.message : "database unreachable",
    };
  }
}

export async function GET() {
  const database = await checkDatabase();

  // Placeholder until the OneDrive export job ships (Phase 1, later slice).
  // Once real, a stale timestamp here is the stalled-sync canary.
  const lastExportAt: string | null = null;

  return NextResponse.json(
    {
      status: database.ok ? "ok" : "degraded",
      checks: { database, lastExportAt },
      timestamp: new Date().toISOString(),
    },
    { status: database.ok ? 200 : 503 }
  );
}
