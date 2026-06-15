import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { setTypeHidden } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

// POST /api/types/[key]/hidden  { hidden: boolean } — show/hide a type from the
// everyday surfaces (ADR-059). The type and its items are untouched; this only
// flips whether it appears in quick capture, +New menus, list tabs, and nav
// destination options.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { hidden?: unknown };
    await setTypeHidden(key, body.hidden === true);
    return NextResponse.json({ ok: true, hidden: body.hidden === true });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
