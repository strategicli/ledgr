import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getExportState } from "@/lib/export/engine";

// /health: the canary endpoint (runbook.md §2). Checks DB reachability and
// the last clean export run; Todoist and Graph checks join it when those
// integrations exist.
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

  // lastExportAt is the last run that finished clean (zero item errors,
  // nothing remaining); lastExportRunAt is the last attempt. A growing gap
  // between them, or a stale lastExportAt, is the stalled-export canary
  // (null until Brandon configures the Azure app registration, runbook §1).
  let lastExportAt: string | null = null;
  let lastExportRunAt: string | null = null;
  if (database.ok) {
    try {
      const state = await getExportState();
      lastExportAt = state?.lastSuccessAt ?? null;
      lastExportRunAt = state?.lastRunAt ?? null;
    } catch {
      // job_state being unreadable while select 1 works is strange enough
      // to surface as nulls rather than fail the whole check.
    }
  }

  return NextResponse.json(
    {
      status: database.ok ? "ok" : "degraded",
      checks: { database, lastExportAt, lastExportRunAt },
      timestamp: new Date().toISOString(),
    },
    { status: database.ok ? 200 : 503 }
  );
}
