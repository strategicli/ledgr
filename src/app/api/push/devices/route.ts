import { NextResponse } from "next/server";
import { routeGate } from "@/lib/modules/gate";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { deleteDevice, getDevice, listDevices, pruneSubscription } from "@/lib/push/store";
import { getWebPushSender } from "@/lib/push/web-push";

// The devices signed up for push on THIS copy of Ledgr (Settings >
// Notifications). GET lists them; POST {id} sends that one device a test
// notification and reports what the push service said; DELETE {id} removes it.
// Owner-scoped and gated on the Notification center module like the rest of
// /api/push. The endpoint itself never leaves the server except its host, which
// is enough to tell Google (Chrome, Edge, Android) from Mozilla or Apple.
export const dynamic = "force-dynamic";

function service(endpoint: string): string {
  try {
    const host = new URL(endpoint).host;
    if (host.endsWith("googleapis.com")) return "Google";
    if (host.endsWith("mozilla.com")) return "Mozilla";
    if (host.endsWith("push.apple.com")) return "Apple";
    if (host.endsWith("notify.windows.com")) return "Microsoft";
    return host;
  } catch {
    return "unknown";
  }
}

async function gate() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "notification-center");
  return off ?? owner;
}

export async function GET() {
  const owner = await gate();
  if (owner instanceof Response) return owner;
  try {
    const devices = await listDevices(owner.id);
    return NextResponse.json({
      devices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        service: service(d.endpoint),
        // The browser compares this with its own subscription to mark "this one".
        endpoint: d.endpoint,
        createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// Throws a 400-shaped error (asUuid) that errorResponse turns into a reply.
async function readId(request: Request): Promise<string> {
  const raw = (await request.json().catch(() => ({}))) as { id?: unknown };
  return asUuid(raw.id, "id");
}

export async function POST(request: Request) {
  const owner = await gate();
  if (owner instanceof Response) return owner;
  try {
    const id = await readId(request);
    const sub = await getDevice(owner.id, id);
    if (!sub) return NextResponse.json({ error: "no such device" }, { status: 404 });
    const sender = getWebPushSender();
    if (!sender) {
      return NextResponse.json({ result: "unconfigured" });
    }
    const r = await sender.send(sub, {
      title: "Ledgr test notification",
      body: "If you can read this, notifications reach this device.",
      url: "/settings#notifications",
      tag: `ledgr-test-${id}`,
    });
    if (r.ok) return NextResponse.json({ result: "sent" });
    if (r.gone) {
      // The push service says this sign-up is dead; drop it, as a real send does.
      await pruneSubscription(sub.endpoint);
      return NextResponse.json({ result: "gone" });
    }
    return NextResponse.json({ result: "failed", detail: `${r.status} ${r.detail}`.trim() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  const owner = await gate();
  if (owner instanceof Response) return owner;
  try {
    const id = await readId(request);
    return NextResponse.json({ ok: await deleteDevice(owner.id, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
