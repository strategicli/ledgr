import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import { runExport } from "@/lib/export/engine";
import { getGraphConfig, OneDriveExportTarget } from "@/lib/export/onedrive";

// On-demand "export now" (PRD §5.4), the user-authed twin of the nightly
// cron. Pulpit Ready (next slice) calls this before pinning; until then
// it's reachable from the browser console or any signed-in fetch.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const owner = await resolveOwner();
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cfg = getGraphConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "export target not configured" },
      { status: 503 }
    );
  }
  const result = await runExport(owner.id, new OneDriveExportTarget(cfg));
  return NextResponse.json(result);
}
