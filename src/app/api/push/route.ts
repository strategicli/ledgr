import { NextResponse } from "next/server";
import { routeGate } from "@/lib/modules/gate";
import { requireOwner } from "@/lib/api";
import { getVapidConfig } from "@/lib/push/vapid";

// The client reads this to decide whether to offer the notifications toggle
// and to get the applicationServerKey for PushManager.subscribe(). Returns the
// VAPID public key only (never the private key); null when notifications
// aren't configured (VAPID keys unset — runbook §1e). Owner-gated so a
// signed-out caller learns nothing.
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "notification-center");
  if (off) return off;

  const config = getVapidConfig();
  return NextResponse.json({
    configured: !!config,
    publicKey: config?.publicKey ?? null,
  });
}
