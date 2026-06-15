import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { setTypeQuickCapture } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

// POST /api/types/[key]/quick-capture  { showInQuickCapture: boolean } — flip
// whether the type appears in the quick-capture dropdown, from the Build → Types
// "Quick Capture" column (ADR-059). Nothing else about the type changes.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      showInQuickCapture?: unknown;
    };
    const value = body.showInQuickCapture === true;
    await setTypeQuickCapture(key, value);
    return NextResponse.json({ ok: true, showInQuickCapture: value });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
