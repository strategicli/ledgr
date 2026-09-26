// The presentations player (explorations/presentations.md step 2): one
// self-contained HTML page, served for the owner and (later) downloaded for
// offline use. Modeled on src/app/items/[id]/print/route.ts.
//
// Export step: ?format=images lists the item's own image attachments (for the
// player's PNG/JPG export), ?format=json&inline=1 is the deck JSON with slide
// AND design images inlined (also for that export), and ?export=propresenter
// / ?export=pptx download the deck in those formats.
import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import { moduleIsOn } from "@/lib/modules/gate";
import { loadDeck, loadDeckSource } from "@/modules/presentations/lib/render-deck";
import { renderPlayer } from "@/modules/presentations/lib/player-html";
import { inlineImages, inlineDesignImages } from "@/modules/presentations/lib/inline-images";
import { safeDownloadFilename } from "@/modules/presentations/lib/filename";
import { deckToProPresenterText } from "@/modules/presentations/lib/propresenter";
import { listAttachments, attachmentUrl } from "@/lib/attachments";

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
  const params = new URL(req.url).searchParams;

  if (params.get("format") === "images") {
    const files = await listAttachments(owner.id, id);
    const images = files
      .filter((f) => /^image\//i.test(f.contentType))
      .map((f) => ({ src: attachmentUrl(f.id), filename: f.filename }));
    return NextResponse.json({ images });
  }

  const exportKind = params.get("export");
  if (exportKind === "propresenter") {
    const source = await loadDeckSource(owner.id, id);
    if (!source) return new NextResponse("Not found", { status: 404 });
    const text = deckToProPresenterText(source.slides);
    const { ascii, utf8 } = safeDownloadFilename(source.title, "txt");
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      },
    });
  }
  if (exportKind === "pptx") {
    const source = await loadDeckSource(owner.id, id);
    if (!source) return new NextResponse("Not found", { status: 404 });
    const { buildPptx } = await import("@/modules/presentations/lib/pptx");
    const buf = await buildPptx(owner.id, source);
    const { ascii, utf8 } = safeDownloadFilename(source.title, "pptx");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      },
    });
  }

  const deck = await loadDeck(owner.id, id);
  if (!deck) return new NextResponse("Not found", { status: 404 });

  if (params.get("format") === "json") {
    if (params.get("inline") === "1") {
      const design = await inlineDesignImages(owner.id, deck.design);
      const slides = await Promise.all(
        deck.slides.map(async (s) => ({
          html: await inlineImages(owner.id, s.html),
          notesHtml: await inlineImages(owner.id, s.notesHtml),
        }))
      );
      return NextResponse.json({ ...deck, design, slides });
    }
    return NextResponse.json(deck);
  }

  if (params.get("download") === "1") {
    const design = await inlineDesignImages(owner.id, deck.design);
    const slides = await Promise.all(
      deck.slides.map(async (s) => ({
        html: await inlineImages(owner.id, s.html),
        notesHtml: await inlineImages(owner.id, s.notesHtml),
      }))
    );
    const html = renderPlayer({ ...deck, design, slides, mode: "offline" });
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
