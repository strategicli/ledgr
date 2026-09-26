// Public live follow (step 6): no session, an unguessable token is the
// credential — same posture as /share/[token]. Notes never reach this route:
// every slide's notesHtml is blanked before it leaves loadDeck's shape.
import { NextResponse } from "next/server";
import { moduleIsOn } from "@/lib/modules/gate";
import { loadDeck } from "@/modules/presentations/lib/render-deck";
import { renderPlayer } from "@/modules/presentations/lib/player-html";
import { inlineImages } from "@/modules/presentations/lib/inline-images";
import { readLive } from "@/modules/presentations/lib/live";

export const dynamic = "force-dynamic";

const ENDED = "This presentation has ended.";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const live = await readLive(token);
  if (!live || !(await moduleIsOn(live.ownerId, "presentations"))) {
    return new NextResponse(ENDED, { status: 404 });
  }

  const params = new URL(req.url).searchParams;

  if (params.get("format") === "state") {
    return NextResponse.json(
      { state: live.state, version: live.version },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const deck = await loadDeck(live.ownerId, live.itemId);
  if (!deck) return new NextResponse(ENDED, { status: 404 });
  // Viewers have no session, so /files/ images must be inlined as data URIs.
  const slides = await Promise.all(
    deck.slides.map(async (s) => ({ html: await inlineImages(live.ownerId, s.html), notesHtml: "" }))
  );

  if (params.get("format") === "json") {
    return NextResponse.json(
      { ...deck, slides },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const html = renderPlayer({ ...deck, slides, mode: "follow" });
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
