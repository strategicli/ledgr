// The fill, one request at a time (ADR-277). Authenticated by the device token
// the pairing minted (the same sync_peers check /api/machine/sync uses), then
// allowed only for THAT device and only while this copy is being filled. Each
// request is one transaction sized to finish well inside the function limit.
import { NextResponse } from "next/server";
import { verifySyncDevice } from "@/lib/sync/auth";
import { PairError, runFillStep, type FillBody } from "@/lib/sync/pairing-cloud";
import { captureError, createLogger, errorMessage } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const peer = await verifySyncDevice(request.headers.get("authorization"));
  if (!peer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const log = createLogger("pairing-fill");
  let body: FillBody;
  try {
    body = (await request.json()) as FillBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return NextResponse.json(await runFillStep(peer.deviceId, body));
  } catch (err) {
    if (err instanceof PairError) {
      log.warn("fill step refused", { step: body.step, table: body.table, reason: err.message });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    await captureError("pairing-fill", err, { correlationId: log.correlationId });
    log.error("fill step failed", { step: body.step, table: body.table, message: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
