import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { clearActiveContext, setActiveContext } from "@/modules/live-context/lib/active-context";
import { routeGate } from "@/lib/modules/gate";

// Live editing context (ADR-162): the open item canvas reports here what the
// owner is currently looking at (the item, and any text selection), so Claude
// can resolve "this note" / "this sentence" over MCP. Clerk-authed and
// owner-scoped via requireOwner — this is a browser-session write, not a machine
// token. Owned by the live-context module (ADR-272 step 4): while it is off,
// POST answers 404 through the shared gate, so a stale client can't keep a row
// alive after the owner turns tracking off. DELETE stays open: clearing the row
// is always safe, and it lets a tab opened before the switch clean up after itself.
export const dynamic = "force-dynamic";

// POST — upsert the owner's active context. Body: { itemId, title?,
// selectionText? }. A missing/blank selectionText clears the highlight.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  const off = await routeGate(owner.id, "live-context");
  if (off) return off;

  try {
    const body = (await request.json()) as {
      itemId?: unknown;
      title?: unknown;
      selectionText?: unknown;
    };
    const itemId = asUuid(body.itemId, "itemId");
    await setActiveContext(owner.id, {
      itemId,
      title: typeof body.title === "string" ? body.title : null,
      selectionText:
        typeof body.selectionText === "string" ? body.selectionText : null,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE — clear the owner's active context (the canvas closed). Idempotent.
// An optional ?itemId= makes it conditional: clear only if the row still points
// at that item. Trackers always send it, so a DELETE from a canvas that's being
// handed off (item → item, or the Desk moving the pen between panels) can't land
// after the incoming POST and blank the fresh context.
export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const raw = new URL(request.url).searchParams.get("itemId");
    const onlyItemId = raw ? asUuid(raw, "itemId") : undefined;
    await clearActiveContext(owner.id, onlyItemId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
