// Inline label fix (ADR-068): a lightweight rename endpoint for the "punch
// through the line" inline edits on the item view. Unlike the full builder PATCH
// (/api/types/[key]), this moves only a display label and never resends the
// whole definition, so it can't clobber a concurrent schema edit. Body:
//   { label }                  → rename the type's label
//   { label, propertyKey }     → rename that property/relation field's label
// The key/role is immutable either way; this is a pure display rename.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { renamePropertyLabel, renameTypeLabel } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json()) as {
      label?: unknown;
      propertyKey?: unknown;
    };
    const type =
      body.propertyKey != null && body.propertyKey !== ""
        ? await renamePropertyLabel(key, String(body.propertyKey), body.label)
        : await renameTypeLabel(key, body.label);
    return NextResponse.json({ type });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
