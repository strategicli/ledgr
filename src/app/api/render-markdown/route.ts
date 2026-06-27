// POST /api/render-markdown — markdown text → rendered HTML fragment (ADR-125).
// The one server seam the client Preview rides: markdown-it is server-only
// (markdown-render.ts), so a client component can't render markdown itself. It
// posts the body's current text and gets back the same HTML the print/share
// document uses. Owner-scoped (the owner rendering their own content, the same
// trust basis as Save Offline); it touches no row, so it neither reads nor
// mutates an item, it only transforms the text it is handed.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { markdownToHtml } from "@/lib/markdown-render";

export const dynamic = "force-dynamic";

// Generous ceiling: the largest real body is ~2.6M chars; this only rejects
// absurd payloads, not legitimate documents.
const MAX_RENDER_CHARS = 8_000_000;

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const { text } = await request.json();
    if (typeof text !== "string") {
      return NextResponse.json(
        { error: "text must be a string" },
        { status: 400 }
      );
    }
    if (text.length > MAX_RENDER_CHARS) {
      return NextResponse.json({ error: "text too large" }, { status: 413 });
    }
    return NextResponse.json({ html: markdownToHtml(text) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
