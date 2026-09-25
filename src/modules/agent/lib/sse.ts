// Stream a LiveTurn to the browser as server-sent events: replay what's
// buffered, follow live, heartbeat every 15s (Cloudflare drops an idle
// connection after ~100s), end when the turn is done. The client leaving never
// stops the turn; it keeps running and persists, and a reconnect replays.
import type { LiveTurn } from "./chat";

const END = new Set(["done", "interrupted"]);

export function streamTurn(turn: LiveTurn, signal: AbortSignal, from = 0): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        turn.subs.delete(onEvent);
        try {
          controller.close();
        } catch {
          // Client already gone.
        }
      };
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(enc.encode(chunk));
      };
      const onEvent = (e: { seq: number; event: string; data: unknown }) => {
        send(`id: ${e.seq}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
        if (END.has(e.event)) close();
      };
      const beat = setInterval(() => send(": keepalive\n\n"), 15_000);
      send(`event: turn\ndata: ${JSON.stringify({ turnId: turn.id, sessionId: turn.sessionId })}\n\n`);
      for (const e of turn.events.slice(from)) onEvent(e);
      if (!closed) turn.subs.add(onEvent);
      signal.addEventListener("abort", close);
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
