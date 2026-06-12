import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verifyMachineToken } from "@/lib/auth/machine";
import { getDb } from "@/db";
import { errorLog, users } from "@/db/schema";
import { runExport } from "@/lib/export/engine";
import { getGraphConfig, OneDriveExportTarget } from "@/lib/export/onedrive";

// Nightly OneDrive export (vercel.json cron; PRD §5.4). Same door as the
// purge: Vercel sends GET with CRON_SECRET, a raw cron-scoped machine token.
export const dynamic = "force-dynamic";
// Attachment copies can be large; take the full minute the plan allows.
export const maxDuration = 60;

// The export writes into one person's OneDrive, so the job belongs to the
// matching users row (multi-user-ready: a future per-user export would read
// per-user config instead).
async function resolveExportOwner(upn: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, upn.toLowerCase()));
  return rows[0]?.id ?? null;
}

export async function GET(request: Request) {
  const identity = verifyMachineToken(
    request.headers.get("authorization"),
    "cron"
  );
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const correlationId = crypto.randomUUID();
  const cfg = getGraphConfig();
  if (!cfg) {
    // Not configured yet is a visible condition, not a crash and not a
    // silent skip.
    console.warn(
      JSON.stringify({
        source: "export",
        correlationId,
        message: "export target not configured (GRAPH_* / ONEDRIVE_* env unset)",
      })
    );
    return NextResponse.json(
      { ok: false, correlationId, error: "export target not configured" },
      { status: 503 }
    );
  }

  try {
    const ownerId = await resolveExportOwner(cfg.upn);
    if (!ownerId) {
      throw new Error(`no users row matches ONEDRIVE_EXPORT_UPN ${cfg.upn}`);
    }
    const itemErrors: { itemId: string; message: string }[] = [];
    const result = await runExport(ownerId, new OneDriveExportTarget(cfg), {
      onError: (itemId, err) =>
        itemErrors.push({
          itemId,
          message: err instanceof Error ? err.message : String(err),
        }),
    });
    console.log(
      JSON.stringify({ source: "export", correlationId, ...result })
    );
    if (itemErrors.length > 0) {
      await getDb().insert(errorLog).values({
        correlationId,
        source: "export",
        message: `${itemErrors.length} item(s) failed to export`,
        detail: { itemErrors },
      });
    }
    return NextResponse.json({ ok: true, correlationId, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ source: "export", correlationId, message })
    );
    try {
      await getDb().insert(errorLog).values({
        correlationId,
        source: "export",
        message,
        detail: err instanceof Error && err.stack ? { stack: err.stack } : null,
      });
    } catch {
      // DB down is the likely cause; the console line above is the record.
    }
    return NextResponse.json({ ok: false, correlationId }, { status: 500 });
  }
}
