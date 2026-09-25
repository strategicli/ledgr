// The cloud copy's pairing door (ADR-277). Public like every /api/machine route;
// what it answers is decided in src/lib/sync/pairing-cloud.ts.
//
//   GET  → is this copy empty, unowned and open to pairing? (A copy that has an
//          owner says only that it is a Ledgr and its schema version.)
//   POST {code, name} → the hub offering the code the owner typed on /setup.
//          On a match, the hub's device token, exactly once.
import { NextResponse } from "next/server";
import { claimPairing, cloudStatus, PairError } from "@/lib/sync/pairing-cloud";
import { captureError, createLogger, errorMessage } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await cloudStatus());
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const log = createLogger("pairing");
  const body = (await request.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
  try {
    const res = await claimPairing(body.code, body.name);
    log.info("paired with a hub", { deviceId: res.deviceId });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof PairError) {
      // Every refusal is visible in the logs (never the code itself).
      log.warn("pairing refused", {
        status: err.status,
        reason: err.message,
        ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
      });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    await captureError("pairing", err, { correlationId: log.correlationId });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
