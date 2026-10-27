// The phone remote for a live show. GET is the page (or ?format=json, the
// slide list after an edit); POST is one tap. No session on the phone: the
// secret key from the presenter's QR code is the credential for taps, and the
// page itself carries nothing the public follow link doesn't (notes never
// leave loadDeck's shape here either).
import { NextResponse } from "next/server";
import { moduleIsOn } from "@/lib/modules/gate";
import { loadDeck } from "@/modules/presentations/lib/render-deck";
import { readLive, pushRemoteCommand } from "@/modules/presentations/lib/live";
import { parseRemoteCommand } from "@/modules/presentations/lib/live-state";
import { renderRemote } from "@/modules/presentations/lib/remote-html";

export const dynamic = "force-dynamic";

const ENDED = "This presentation has ended.";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const live = await readLive(token);
  if (!live || !(await moduleIsOn(live.ownerId, "presentations"))) {
    return new NextResponse(ENDED, { status: 404 });
  }
  const deck = await loadDeck(live.ownerId, live.itemId);
  if (!deck) return new NextResponse(ENDED, { status: 404 });
  const slides = deck.slides.map((s) => s.html);

  if (new URL(req.url).searchParams.get("format") === "json") {
    return NextResponse.json(
      { version: deck.version, slides },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  return new NextResponse(renderRemote({ title: deck.title, version: deck.version, slides }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const { key, cmd } = (body ?? {}) as Record<string, unknown>;
  const command = parseRemoteCommand(cmd);
  if (typeof key !== "string" || !command) return new NextResponse("Bad request", { status: 400 });

  const live = await readLive(token);
  if (!live || !(await moduleIsOn(live.ownerId, "presentations"))) {
    return new NextResponse(ENDED, { status: 404 });
  }
  if (!(await pushRemoteCommand(token, key, command))) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(null, { status: 204 });
}
