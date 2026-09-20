import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { setTypeQuickCapture, setTypeQuickCaptureProperties } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

// POST /api/types/[key]/quick-capture — the type's quick-add settings, from the
// Build → Types row (ADR-059, ADR-268). Either field may be sent alone:
//   { showInQuickCapture: boolean }        flip the type in the type picker
//   { quickCaptureProperties: string[] }   which properties show as chips
// Nothing else about the type changes.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      showInQuickCapture?: unknown;
      quickCaptureProperties?: unknown;
    };
    const out: Record<string, unknown> = { ok: true };
    if (typeof body.showInQuickCapture === "boolean") {
      await setTypeQuickCapture(key, body.showInQuickCapture);
      out.showInQuickCapture = body.showInQuickCapture;
    }
    if (Array.isArray(body.quickCaptureProperties)) {
      const keys = body.quickCaptureProperties.filter((k) => typeof k === "string") as string[];
      await setTypeQuickCaptureProperties(key, keys);
      out.quickCaptureProperties = keys;
    }
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
