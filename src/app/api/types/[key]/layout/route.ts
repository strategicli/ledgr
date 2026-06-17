// Item-canvas layout endpoint (ADR-069, Feature B): the arrange UI PATCHes a
// type's saved layout here. Like the rename endpoint (ADR-068), this is a focused
// route — it writes only the canvas_layout column, never the whole definition, so
// it can't clobber a concurrent schema edit from the builder. Body:
//   { layout }        → save this CanvasLayout for the type
//   { layout: null }  → reset to the generated default (classic render)
// The layout is validated/normalized by setTypeCanvasLayout (parseCanvasLayout),
// so a malformed shape is a 400, not a corrupt row. Owner-guarded like the other
// type routes (types are instance-global; requireOwner gates the mutation).
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { setTypeCanvasLayout } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json()) as { layout?: unknown };
    const type = await setTypeCanvasLayout(key, body.layout ?? null);
    return NextResponse.json({ type });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
