// Save Offline's document render (PRD §4.7): a self-contained HTML page —
// inline CSS, no scripts beyond one print button handler, no app chrome, no
// /_next chunks. Self-containment is the point: this exact response is what
// the pin protocol stores in the service worker's ledgr-pin-v1 cache, so it
// must render offline with nothing else cached, and its @media print rules
// make the browser's print-to-PDF the PDF leg. Dark on screen (stage
// friendly, app-consistent), black-on-white in print.
import { NextResponse } from "next/server";
import { ItemError, getItem } from "@/lib/items";
import { renderPrintDocument } from "@/lib/print-html";
import { resolveOwner } from "@/lib/owner";
import { resolveMentions } from "@/lib/mentions";
import { bodyMarkdown } from "@/lib/body";
import { collectMentionIdsFromMarkdown } from "@/lib/editor/mention-markdown";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const owner = await resolveOwner();
  if (!owner) return NextResponse.redirect(new URL("/sign-in", _req.url));

  const { id } = await ctx.params;
  let item;
  try {
    item = await getItem(owner.id, id);
  } catch (err) {
    if (err instanceof ItemError) {
      return new NextResponse("Not found", { status: 404 });
    }
    throw err;
  }
  if (item.deletedAt) return new NextResponse("Not found", { status: 404 });

  // Type-aware @-mention icons unless ?icons=0 (the owner's "icons off" choice
  // for a cleaner PDF/offline copy; SaveOffline pins this exact URL).
  const showIcons = new URL(_req.url).searchParams.get("icons") !== "0";
  const mentions = showIcons
    ? await resolveMentions(
        owner.id,
        collectMentionIdsFromMarkdown(bodyMarkdown(item.body))
      )
    : undefined;

  // The same self-contained shell the share route serves (slice 31), so a
  // pinned offline copy and a public link render identically.
  const html = renderPrintDocument(item.title, item.body, { mentions });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never cached by HTTP layers: the pin cache is the one deliberate
      // copy, and it must reflect the moment the user pinned.
      "Cache-Control": "no-store",
    },
  });
}
