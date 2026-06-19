import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import { getGraphMailSource } from "@/lib/email/graph-source";
import { GraphError } from "@/lib/graph/client";

// Reopen an email-in note's original message in Outlook. The note body links
// here rather than to a captured webLink because a message's Graph id — and so
// its webLink — changes when it moves between folders; the stable
// internetMessageId in `?mid=` is re-resolved to the current webLink on each
// click, so the link keeps working after the import move (and any later
// re-filing). Owner-gated: it reads the configured mailbox.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = await resolveOwner();
  if (!owner) return NextResponse.redirect(new URL("/sign-in", request.url));

  const mid = new URL(request.url).searchParams.get("mid");
  if (!mid) return new NextResponse("missing mid", { status: 400 });

  const source = getGraphMailSource();
  if (!source) return new NextResponse("email integration not configured", { status: 503 });

  try {
    const webLink = await source.resolveWebLink(mid);
    if (!webLink) return new NextResponse("message not found", { status: 404 });
    return NextResponse.redirect(webLink);
  } catch (err) {
    if (err instanceof GraphError) {
      return new NextResponse(`Outlook lookup failed: ${err.message}`, { status: 502 });
    }
    throw err;
  }
}
