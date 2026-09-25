// "Keep a copy in the cloud", the hub's owner-facing side (ADR-277). Owner-authed
// like the other /api/sync routes. The Network page polls GET, which also moves
// the pairing on (claims the code once the owner has typed it on the cloud, and
// restarts a fill this process was not running).
//
//   GET                         → the pairing, never the device token
//   POST {action:"start", url, biggerPlan?, usePublicUrl?}
//   POST {action:"retry"}       → after a failed fill
//   POST {action:"dismiss"}     → clear a finished pairing's note
//   DELETE                      → cancel
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  advancePairing,
  cancelPairing,
  dismissPairing,
  retryPairing,
  startPairing,
} from "@/lib/sync/pairing-hub";

export const dynamic = "force-dynamic";

// The fill runs in the background of a long-lived process, which a serverless
// function is not. A cloud copy is the other end of this flow, never the start.
function notHere(): NextResponse | null {
  return process.env.VERCEL_ENV
    ? NextResponse.json({ error: "Start this from the computer that runs your main copy of Ledgr." }, { status: 400 })
    : null;
}

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const refused = notHere();
  if (refused) return refused;
  try {
    return NextResponse.json({ pairing: await advancePairing() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const refused = notHere();
  if (refused) return refused;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      url?: unknown;
      biggerPlan?: unknown;
      usePublicUrl?: unknown;
    };
    if (body.action === "retry") return NextResponse.json({ pairing: await retryPairing() });
    if (body.action === "dismiss") {
      await dismissPairing();
      return NextResponse.json({ pairing: null });
    }
    const res = await startPairing({
      url: body.url,
      biggerPlan: body.biggerPlan === true,
      usePublicUrl: body.usePublicUrl === true,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ pairing: res.state });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const res = await cancelPairing();
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
    return NextResponse.json({ pairing: null });
  } catch (err) {
    return errorResponse(err);
  }
}
