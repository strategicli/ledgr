import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { getItemVersion } from "@/lib/items";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const POLL_MS = 1500;
const HEARTBEAT_MS = 15000;

// GET /api/items/[id]/changes — a server-sent event stream that says "this item
// changed" the moment its updated_at moves (live in-place updates, in-app agent
// Feature 0). The open canvas listens and patches the new body in place, so an
// edit from Claude or another device appears without a reload or a refocus.
//
// It watches the row rather than hooking every writer, so every path (the app,
// MCP, the in-app agent, sync) is covered by one cheap indexed read against the
// local database. Not served on Vercel, where a held-open function is billed by
// the second; there the focus check (ADR-134) is the only signal, as before.
// ponytail: one poll per open canvas; a shared in-process notifier if many
// canvases are ever open at once.
export async function GET(request: Request, context: Context) {
  if (process.env.VERCEL) return new NextResponse(null, { status: 404 });
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  let id: string;
  let last: string;
  try {
    id = asUuid((await context.params).id, "id");
    last = (await getItemVersion(owner.id, id)).updatedAt.toISOString();
  } catch (err) {
    return errorResponse(err);
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      const poll = setInterval(async () => {
        try {
          const now = (await getItemVersion(owner.id, id)).updatedAt.toISOString();
          if (now !== last) {
            last = now;
            send(`data: ${JSON.stringify({ updatedAt: now })}\n\n`);
          }
        } catch {
          // Trashed or unreachable: end the stream; the client falls back to focus.
          stop();
        }
      }, POLL_MS);
      const beat = setInterval(() => send(": keepalive\n\n"), HEARTBEAT_MS);
      request.signal.addEventListener("abort", stop);
      send(": open\n\n");
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
