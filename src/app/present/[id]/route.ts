// The presentations player (explorations/presentations.md step 2): one
// self-contained HTML page, served for the owner and (later) downloaded for
// offline use. Modeled on src/app/items/[id]/print/route.ts.
import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import { moduleIsOn } from "@/lib/modules/gate";
import { loadDeck } from "@/modules/presentations/lib/render-deck";
import { renderPlayer } from "@/modules/presentations/lib/player-html";
import { inlineImages } from "@/modules/presentations/lib/inline-images";
import { safeDownloadFilename } from "@/modules/presentations/lib/filename";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const owner = await resolveOwner();
  if (!owner) return NextResponse.redirect(new URL("/sign-in", req.url));

  if (!(await moduleIsOn(owner.id, "presentations"))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { id } = await ctx.params;
  const deck = await loadDeck(owner.id, id);
  if (!deck) return new NextResponse("Not found", { status: 404 });

  const params = new URL(req.url).searchParams;
  if (params.get("format") === "json") {
    return NextResponse.json(deck);
  }

  if (params.get("download") === "1") {
    const slides = await Promise.all(
      deck.slides.map(async (s) => ({
        html: await inlineImages(owner.id, s.html),
        notesHtml: await inlineImages(owner.id, s.notesHtml),
      }))
    );
    const html = renderPlayer({ ...deck, slides, mode: "offline" });
    const { ascii, utf8 } = safeDownloadFilename(deck.title);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      },
    });
  }

  const html = renderPlayer({ ...deck, mode: "owner", downloadUrl: `/present/${id}?download=1` });
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
