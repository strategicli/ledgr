import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { templateAskLabels } from "@/lib/templates";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/templates/[id]/vars — the {{ask:Label}} prompts a template will ask
// on apply (scanned across its prototype subtree). The "+ New" / chooser apply
// path fetches this first; if non-empty it shows a small form, else applies
// straight away (ADR-093, TPL3).
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    const askLabels = await templateAskLabels(owner.id, id);
    return NextResponse.json({ askLabels });
  } catch (err) {
    return errorResponse(err);
  }
}
