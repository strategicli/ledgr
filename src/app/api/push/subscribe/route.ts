import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { deleteSubscription, saveSubscription } from "@/lib/push/store";

// Subscribe/unsubscribe the current browser's push subscription (slice 30).
// The client posts what PushManager.subscribe() produced (endpoint + the two
// encryption keys); DELETE drops it by endpoint. Owner-scoped; Clerk-protected
// (not in the public-route set), so the machine-token door is never involved.
export const dynamic = "force-dynamic";

type Body = { endpoint?: unknown; p256dh?: unknown; auth?: unknown };

function readSubscription(raw: unknown): {
  endpoint: string;
  p256dh: string;
  auth: string;
} | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Body;
  if (
    typeof b.endpoint !== "string" ||
    typeof b.p256dh !== "string" ||
    typeof b.auth !== "string" ||
    !b.endpoint ||
    !b.p256dh ||
    !b.auth
  ) {
    return null;
  }
  // Endpoint must be an https URL (the push service); reject anything else so
  // the sender never POSTs to an arbitrary origin.
  try {
    if (new URL(b.endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth };
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const sub = readSubscription(await request.json());
    if (!sub) {
      return NextResponse.json(
        { error: "endpoint, p256dh, and auth are required" },
        { status: 400 }
      );
    }
    await saveSubscription(owner.id, sub);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const raw = await request.json().catch(() => ({}));
    const endpoint = (raw as Body).endpoint;
    if (typeof endpoint !== "string" || !endpoint) {
      return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    }
    await deleteSubscription(owner.id, endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
